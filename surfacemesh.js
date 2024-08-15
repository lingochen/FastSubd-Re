/**
 * DirectedEdge instead of traditional HalfEdge. 
 * Same operation as HalfEdge, implicit next/prev and explicit pair data member.
 * Traditional HalfEdge is explicit next/prev but implicit pair data member.
 * AddFace() different logic from HalfEdge.
 * better cache coherence and more similar to traditional face/vertex representation.
 * easier to optimize for parallel subdivision.
 * Only triangle mesh here, general polygon is better handle of traditional HalfEdge. (2024/08/14)
 * 
 * triangle ratio vertex(4):edge(5):triangle(3)
 * quad ratio vertex(4):edge(4):quad(2)
 * 
 * Provided 5 classes.
 * VertexArray
 * HalfEdgeArray
 * FaceArray
 * HoleArray
 * SurfaceMesh
 */
 

import {Int32PixelArray, Float32PixelArray, Uint8PixelArray, Float16PixelArray, rehydrateBuffer, createDynamicProperty, allocBuffer, freeBuffer, alignCache} from './pixelarray.js';
import {vec3, vec3a} from "./vec3.js";
import {expandAllocLen, computeDataTextureLen} from "./glutil.js";


/**
 * let browser decided if it validVarName, copy from stackoverflow
 */
function isValidVarName(name) {
   try {
      Function('var ' + name);
   } catch(e) {
      return false;
   }
   return true;
}

function dehydrateObject(obj) {
   const json = {};
   for (let [key, prop] of Object.entries(obj)) {
      json[key] = prop.getDehydrate({});
   }
   
   return json;
};

function rehydrateObject(json) {
   const retObj = {};
   for (let [key, prop] of Object.entries(json)) {
      retObj[key] = rehydrateBuffer(prop);
   }
   return retObj;
}

/**
 * add up objs pixelbuffers's structure size in bytes, with length and cache alignment.
 */
function totalStructSize(objs, length) {
   let totalByte = 0;
   for (let [key, buffer] of Object.entries(objs)) {
      totalByte += alignCache(buffer.computeBufferSize(length));
   }
   return totalByte;
}

/**
 * iterate over the array, setBuffer accordingly.
 */
function setBufferAll(objs, bufferInfo, byteOffset, length) {
   for (let [key, buffer] of Object.entries(objs)) {
      byteOffset = alignCache(buffer.setBuffer(bufferInfo, byteOffset, length));
   }
   return byteOffset;
}


/**
 * A Point,
 * @typedef {Struct} Point
 * @property {number} x - 
 * @property {number} y 
 * @property {number} z
 * @property {number} c - crease, and may pack other attributes.
 */
const PointK = {
   x: 0,
   y: 1,
   z: 2,
   c: 3,             // to be used by crease and other attributes if...
};
Object.freeze(PointK);
const sizeOfPointK = 4;

/**
// hEdge: 
// pt: 
// normal: 
// color:
// valence: 
// crease:      // (-1=corner, 3 edge with sharpness), (0=smooth, (0,1) edge with sharpness), (>1 == crease, 2 edge with sharpness))
*/
class VertexArray {
   constructor(array, props, valenceMax) {
      this._base = array;
      this._prop = props;           // custom properties.
      this._valenceMax = valenceMax;
   }
   
   static create(size) {
      const array = {
         hEdge: Int32PixelArray.create(1, 1, size),               // point back to the one of the hEdge ring that own the vertex. 
         pt: Float32PixelArray.create(sizeOfPointK, 4, size),     // pts = {x, y, z}, 3 layers of float32 each? or 
      };
      const prop = {
         color: Uint8PixelArray.create(4, 4, size),               // should we packed to pts as 4 channels(rgba)/layers of textures? including color?
         // cached value
         normal: Float16PixelArray.create(3, 3, size),
         valence: Int32PixelArray.create(1, 1, size),
      };

      return new VertexArray(array, prop, 0);
   }

   static rehydrate(self) {
      if (self._base && self._prop) {
         const array = rehydrateObject(self._base);
         const prop = rehydrateObject(self._prop);
         return new VertexArray(array, prop, self._valenceMax);
      }
      throw("VertexArray rehydrate: bad input");
   }

   getDehydrate(obj) {
      obj._base = dehydrateObject(this._base);
      obj._prop = dehydrateObject(this._prop);
      
      obj._valenceMax = this._valenceMax;
      
      return obj;
   }
   
   /**
    * 
    */
   computeBufferSize(length) {
      return totalStructSize(this._base, length)
             + totalStructSize(this._prop, length);
   }
   
   /**
    * use new buffer with length as capacity
    */
   setBuffer(bufferInfo, byteOffset, length) {
      if (!bufferInfo) {   // no buffer, so that meant new separate buffer
         bufferInfo = allocBuffer(this.computeBufferSize(length));
      }
      
      byteOffset = setBufferAll(this._base, bufferInfo, byteOffset, length);
      byteOffset = setBufferAll(this._prop, bufferInfo, byteOffset, length);
      
      return byteOffset;
   }
   
   addProperty(name, type) {
      //if (isValidVarName(name)) {
         if (this._prop[name] === undefined) { // don't already exist
            // create DynamicProperty for accessing data
            this._prop[name] = createDynamicProperty(type, this.length());
            return this._prop[name];
         }
      //}
      return false;
   }
   
   getProperty(name, index) {
      if (index === undefined) {
         return this._prop[name];
      } else {
         return this._prop[name][index];
      }
   }
   
   removeProperty(name) {
      if (this._prop[name]) {
         delete this._prop[name];
         return true;
      }
      return false;
   }
   
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this._base.hEdge.length());
   }

   * rangeIter(start, stop) {
      stop = Math.min(this._base.hEdge.length(), stop);
      for (let i = start; i < stop; i++) {
         if (!this.isFree(i)) {
            yield i;
         }
      }
   }
   
   * outHalfEdgeAround(hEdgeContainer, vert) {
      if (this._prop.valence.get(vert, 0) >= 0) { // initialized yet?
         const start = this._base.hEdge.get(vert, 0);
         let current = start;
         do {
            const outEdge = current;
            const pair = hEdgeContainer.pair(current);
            current = hEdgeContainer.next( pair );
            yield outEdge;
         } while (current !== start);
      }
   }
   
   // ccw ordering
   * inHalfEdgeAround(hEdgeContainer, vert) {
      if (this._prop.valence.get(vert, 0) >= 0) { // initialized yet?
         const start = this._base.hEdge.get(vert, 0);
         let current = start;
         do {
            const inEdge = hEdgeContainer.pair(current);
            current = hEdgeContainer.next( inEdge );
            yield inEdge;
         } while (current !== start);
      }
   }
   
   // faceAround(vert)
   // vertexAround(vert)
   // wEdgeAround(vert)

   createPositionTexture(gl) {
      return this._base.pt.createDataTexture(gl);
   }
   
   createNormalTexture(gl) {
      return this._prop.normal.createDataTexture(gl);
   }
   
   positionBuffer() {
      return this._base.pt.getBuffer();
   }

   // the maximum valence ever in this VertexArray.
   valenceMax() {
      return this._valenceMax;
   }

   valence(vertex) {
      return this._prop.valence.get(vertex, 0);
   }
   
   setValence(vertex, valence) {
      this._prop.valence.set(vertex, 0, valence);
   }

   crease(vertex) {
      return this._base.pt.get(vertex, PointK.c);
   }

   setCrease(vertex, crease) {
      this._base.pt.set(vertex, PointK.c, crease);
   }

   computeValence(hEdgeContainer) {
      let valenceMax = 0;
      for (let i of this) {
         const start = this._base.hEdge.get(i, 0);
         if (start >= 0) {
            let count = 0;
            let current = start;
            let sharpness = 0;
            let creaseCount = 0;
            do {
               if (creaseCount < 3) {
                  let value = hEdgeContainer.sharpness(current);
                  if (value > 0) {
                     if (sharpness !== 0) {  // get minimum excluding zero
                        sharpness = Math.min(sharpness, value);
                     } else {
                        sharpness = value;
                     }
                     creaseCount++;
                  } else if (value < 0) { // boundaryEdge create corner like condition.
                     creaseCount = 3;
                  }
               }
               const pair = hEdgeContainer.pair(current);
               current = hEdgeContainer.next( pair );
               count++;
            } while (current !== start);
            if (count > valenceMax) {
               valenceMax = count;
            }
            this.setValence(i, count);
            if (creaseCount > 2) {
               this.setCrease(i, -1);
            } else if (creaseCount === 2) {
               this.setCrease(i, sharpness);
            } else {
               this.setCrease(i, 0);
            }

         }
      }
      this._valenceMax = valenceMax;
   }
   
   /**
    * Loop bitangent scheme
    */
   computeLoopNormal(hEdgeContainer) {
      const tangentL = [0, 0, 0];
      const tangentR = [0, 0, 0];
      const temp = [0, 0, 0];
      const handle = {face: 0};
      const pt = this._base.pt.getBuffer();
      for (let v of this) {     
         const valence = this.valence(v);
         const radStep = 2*Math.PI / valence;
                  
         let i = 0;
         tangentL[0] = tangentL[1] = tangentL[2] = tangentR[0] = tangentR[1] = tangentR[2] = 0.0;
         for (let hEdge of this.outHalfEdgeAround(hEdgeContainer, v)) {
            let p = hEdgeContainer.destination(hEdge);
            let coseff = Math.cos(i*radStep);
            let sineff = Math.sin(i*radStep);
            vec3a.scaleAndAdd(tangentL, 0, pt, p * sizeOfPointK, coseff);
            vec3a.scaleAndAdd(tangentR, 0, pt, p * sizeOfPointK, sineff);
            i++;  // next face
         }
         // now we have bi-tangent, compute the normal
         vec3.cross(temp, 0, tangentL, 0, tangentR, 0);
         vec3a.normalize(temp, 0);
         this._prop.normal.setVec3(v, 0, temp);      
         
      }
   }
   
   /**
    * using stencil like value for computing bi-tangent. using bi-tangent to compute normal.
    *  1 4  1       -1 0 1
    *  0 0  0  and  -4 0 4
    * -1 4 -1       -1 0 1
    * take loop's ideas, using cos/sin to approximating bi-tanent.
    * on connecting edges, cos(i)*4/k *p, sin(i)*4/k *p.  for secondary ring cos/sin(i+offset)/k * p.
    */
/* Note: to be removed
 * 
 *    computeCCNormal(hEdgeContainer) {
      const tangentL = [0, 0, 0];
      const tangentR = [0, 0, 0];
      const temp = [0, 0, 0];
      const handle = {face: 0};
      const pt = this._base.pt.getBuffer();
      for (let v of this) {
         // compute angleStep (primary, secondary ring), 
         const valence = this.valence(v);
         const radStep = 2*Math.PI / valence;
         const offset = radStep / 2;
         
         let i = 0;
         tangentL[0] = tangentL[1] = tangentL[2] = tangentR[0] = tangentR[1] = tangentR[2] = 0.0;
         for (let hEdge of this.outHalfEdgeAround(hEdgecontainer, v)) {
            const hEdges = [];
            for (let dEdge of hEdgeContainer.faceIter(hEdge)) { 
               hEdges.push( dEdge );
            }
            // first(the ring), add up primary
            let p = hEdgeContainer.origin(hEdges[1]);
            let coseff = Math.cos(i*radStep) * 2.9;
            let sineff = Math.sin(i*radStep) * 2.9;
            vec3.addAndScale(tangentL, 0, pt, p * sizeOfPointK, coseff);
            vec3.addAndScale(tangentR, 0, pt, p * sizeOfPointK, sineff);
            
            // 2-nextToLast(ring, avg), the secondary ring if any
            coseff = Math.cos(i*radStep+offset);
            sineff = Math.sin(i*radStep+offset);
            if (hEdges.length === 4) { // normal quad
               p = hEdgeContainer.origin(hEdges[2]);
               vec3a.scaleAndAdd(tangentL, 0, pt, p * sizeOfPointK, coseff);
               vec3a.scaleAndAdd(tangentR, 0, pt, p * sizeOfPointK, sineff);
            } else {
               if (hEdges.length === 3) {       // use diagonal avg
                  vec3a.addAndScale(temp, 0, pt, p * sizeOfPointK, pt, hEdgeContainer.origin(hEdges[2]) * sizeOfPointK, 0.5);
               } else { //if (hEdges.length > 4) { // avg all ring
                  let length = hEdges.length - 3;
                  const scale = 1/length;
                  vec3.scale(temp, 0,  pt, hEdgeContainer.origin(hEdges[2]) * sizeOfPointK, scale); 
                  for (let j = 3; j < (length+2); ++j) {
                     vec3a.scaleAndAdd(temp, 0, pt, hEdgeContainer.origin(hEdges[j])*sizeOfPointK, scale);
                  }
               }
               vec3a.scaleAndAdd(tangentL, 0, temp, 0, coseff);
               vec3a.scaleAndAdd(tangentR, 0, temp, 0, sineff);
            }
            // next face, 
            i++
         }
         // now we have bi-tangent, compute the normal
         vec3.cross(temp, 0, tangentL, 0, tangentR, 0);
         vec3a.normalize(temp, 0);
         this._prop.normal.setVec3(v, 0, temp);
      }
   }
*/

   /**
    * should be allocated from free first.
    * 
    */
   alloc() {
      return this._allocEx(1);
   }

   /**
    * used by subdivision, and alloc()
    */
   _allocEx(size) {
      if (this._base.hEdge.capacity() < size) {  // realloc if no capacity.
         this.setBuffer(null, 0, expandAllocLen(this._base.hEdge.maxLength()+size));
      }
      
      const start = this.length();
      for (let key of Object.keys(this._base)) {
         this._base[key].appendRangeNew(size);
      }
      for (let key of Object.keys(this._prop)) {
         this._prop[key].appendRangeNew(size);
      }
      return start;
   }

   isFree(vert) {
      const c = this._base.pt.get(vert, PointK.c);
      return (c < -1);
   }

   copyPt(vertex, inPt, inOffset) {
      vec3.copy(this._base.pt.getBuffer(), vertex * sizeOfPointK, inPt, inOffset);
      //this._base.pt.set(vertex, 0, 0, inPt[inOffset]);
      //this._base.pt.set(vertex, 0, 1, inPt[inOffset+1]);
      //this._base.pt.set(vertex, 0, 2, inPt[inOffset+2]);
   }
   
   halfEdge(vert) {
      return this._base.hEdge.get(vert, 0);
   }
   
   setHalfEdge(vert, hEdge) {
      this._base.hEdge.set(vert, 0, hEdge);
      let valence = this._prop.valence.get(vert, 0);  // check for init
      if (valence < 0) {
         this._prop.valence.set(vert, 0, 1);
      }
   }
   
/* Note: to be removed.  
 * 
 * 
 * findFreeInEdge(hEdgeContainer, vert) {
      for (let inEdge of this.inHalfEdgeAround(hEdgeContainer, vert)) {
         if (hEdges.face(inEdge) < 0) {
            return inEdge;
         }
      }
      return -1;
   } */

   sanityCheck(hEdgeContainer) {
      let sanity = true;
      for (let vertex of this) {
         let outEdge = this.halfEdge(vertex);
         if (outEdge < 0) {   // not initialized yet
            break;
         }
         let expect = hEdgeContainer.origin(outEdge);
         if (expect !== vertex) {
            console.log("vertex " + vertex + "'s outEdge " + outEdge + " is wrong, expected: " + expect);
            sanity = false;
         } else { // check prev,next are the same. 
            let iterationCount = 0;    // make sure, no infinite loop
            for (let outEdge of this.outHalfEdgeAround(hEdgeContainer, vertex)) {
               const orig = hEdgeContainer.origin(outEdge);
               if (orig !== vertex) {
                  console.log("vertex: " + vertex + "'s circulator is broken");
                  sanity = false;
                  break;
               }
               if (iterationCount++ >= 1024) {
                  console.log("vertex: " + vertex + " has more than 1024 edges, likely broken");
                  sanity = false;
                  break;
               }
            }
         }
      }
      // now check polygon?
      
      return sanity;
   };
   
   stat() {
      return "Vertices Count: " + this._base.hEdge.length() + ";\n";
   }
   
   length() {
      return this._base.pt.length();
   }
}


const wEdgeK = {
   left: 0,                      // pair directedEdge/halfEdge
   right: 1,
   sizeOf: 2,   
}



class HalfEdgeArray {
   constructor(dArray, hArray, wEdgeArray, fmm, props) {
      // tri/quad directededge
      this._dArray = dArray;
      // boundaryLoop edge/polygon edge
      this._hArray = hArray;
      // wEdge specific value
      this._wEdgeArray = wEdgeArray;
      // freed array slot memory manager, should tried to keep array slots packed
      this._fmm = fmm;
      // 
      this._mesh = null;
      this._prop = props;
      this._bufferInfo = null;
   }
   
   static _createInternal(size) {
      const dArray = { // odd number of index and odd number of polygon(triangle) created false sharing, so we have to separate everything out
         vertex: Int32PixelArray.create(1, 1, size),
         pair: Int32PixelArray.create(1, 1, size),             // pair, twin, 
         wEdge: Int32PixelArray.create(1, 1, size),            // point back to wEdge' left or right
      };
      const hArray = {
         vertex: Int32PixelArray.create(1, 1, size),           // point to vertex,
         pair: Int32PixelArray.create(1, 1, size),             // point to pair,
         wEdge: Int32PixelArray.create(1, 1, size),            // point back to wEdge if any
         prev: Int32PixelArray.create(1, 1, size),             // negative value to hEdge
         next: Int32PixelArray.create(1, 1, size),             // negative value
         hole: Int32PixelArray.create(1, 1, size),             // negative value to hole, positive to nGon(QuadEdgeArray). 0 for empty
      };
      const wEdgeArray = {
         edge: Int32PixelArray.create(wEdgeK.sizeOf, 2, size), // [left, right]
         sharpness: Float32PixelArray.create(1, 1, size),   // crease weights is per wEdge, sharpness is float, (int is enough, but subdivision will create fraction, so needs float)
      };
      const fmm = {  // freed array slot memory manager. using linklist for freedlist
         // dArray: {size: 0, head: 0},      // freed syncronized with faceArray
         hArray: {size: 0, head: 0},
         wEdgeArray: {size: 0, head: 0},
      }
      return [dArray, hArray, wEdgeArray, fmm, {}];
   }
   
   static _rehydrateInternal(self) {
      const dArray = rehydrateObject(self._dArray);
      
      const hArray = rehydrateObject(self._hArray);
      const wEdgeArray = rehydrateObject(self._wEdgeArray);
      const fmm = self._fmm;
 
      const props = rehydrateObject(self._prop);
      return [dArray, hArray, wEdgeArray, fmm, props];
   }
   
   getDehydrate(obj) {
      obj._dArray = dehydrateObject(this._dArray);

      obj._hArray = dehydrateObject(this._hArray);

      obj._wEdgeArray = dehydrateObject(this._wEdgeArray);
      
      obj._fmm = this._fmm;
      
      obj._prop = dehydrateObject(this._prop);
      return obj;
   }
   
   computeBufferSize(length) {
      return totalStructSize(this._dArray, length)
            + totalStructSize(this._prop, length);
   }
   
   computeBufferSizeB(length) {
      return totalStructSize(this._hArray, length);
   }
   
   computeBufferSizeW(length) {
      return totalStructSize(this._wEdgeArray, length);
   }
   
   computeBufferSizeAll(length, bLength, wLength) {
      return this.computeBufferSize(length)
            + this.computeBufferSizeB(bLength)
            + this.computeBufferSizeW(wLength);
   }
   
   setBuffer(bufferInfo, byteOffset, length) {
      if (!bufferInfo) {
         bufferInfo = allocBuffer(this.computeBufferSize(length));
         byteOffset = 0;
      }
      
      // necessary property
      byteOffset = setBufferAll(this._dArray, bufferInfo, byteOffset, length);
   
      // set custom property's buffer
      return setBufferAll(this._prop, bufferInfo, byteOffset, length);   //, bLength);
   }
   
   setBufferB(bufferInfo, byteOffset, length) {
      if (!bufferInfo) {
         bufferInfo = allocBuffer(this.computeBufferSizeB(length));
         byteOffset = 0;
      }
      
      return setBufferAll(this._hArray, bufferInfo, byteOffset, length);
   }
   
   setBufferW(bufferInfo, byteOffset, length) {
      if (!bufferInfo) {
         bufferInfo = allocBuffer(this.computeBufferSizeW(length));
         byteOffset = 0;
      }
      
      return setBufferAll(this._wEdgeArray, bufferInfo, byteOffset, length);
   }
   
   setBufferAll(bufferInfo, byteOffset, length, bLength, wLength) {
      if (!bufferInfo) {
         bufferInfo = allocBuffer(this.computeBufferSizeAll(length, bLength, wLength));
         byteOffset = 0;
      }
      
      byteOffset = this.setBuffer(bufferInfo, byteOffset, length);
      byteOffset = this.setBufferB(bufferInfo, byteOffset, bLength);
      
      return this.setBufferW(bufferInfo, byteOffset, wLength);
   }
   
   addProperty(name, type) {
      //if (isValidVarName(name)) {
         if (this._prop[name] === undefined) { // don't already exist
            // create DynamicProperty for accessing data
            this._prop[name] = createDynamicProperty(type, this.length());
            return this._prop[name];
         }
      //}
      return false;
   }
   
   getProperty(name, index) {
      if (index === undefined) {
         return this._prop[name];
      } else {
         return this._prop[name][index];
      }
   }
   
   removeProperty(name) {
      if (this._prop[name]) {
         delete this._prop[name];
         return true;
      }
      return false;
   }
   
   createVertexTexture(gl) {
       return this._dArray.vertex.createDataTexture(gl);
   }

   createPropertyTexture(name, gl) {
      const prop = this._prop[name];
      if (prop) {
         return prop.createDataTexture(gl);
      }
      throw("unknown dynamic property: " + name);
      return null;
   }
   
   pBuffer() {
      return this._dArray.pair.getBuffer();
   }
   
   vBuffer() {
      return this._dArray.vertex.getBuffer();
   }
   
   wBuffer() {
      return this._dArray.wEdge.getBuffer();
   }
   
   // allocation/free routines.
   /**
    * 
    */
   _allocEx(size) {
      if (this._dArray.vertex.capacity() < size) {
         this.setBuffer(null, 0, expandAllocLen(this._dArray.vertex.maxLength()+size));
      }
      
      const index = this._dArray.vertex.appendRangeNew(size);
      this._dArray.pair.appendRangeNew(size);
      this._dArray.wEdge.appendRangeNew(size);
      for (let [_key, prop] of Object.entries(this._prop)) {
         prop.appendRangeNew(size);
      }
      return index;
   }
   
   /**
    * 
    */
   allocWEdge(dEdge, pair) {
      const handle = this._allocWEdge(1);
      //this._wEdgeArray.edge.set(handle, 0, dEdge);
      this.setWEdge(handle, dEdge, pair);
      return handle;
   }
   
   /**
    * used by subdivision
    */
   _allocWEdge(size) {
      if (this._wEdgeArray.edge.capacity() < size) {  // expand by 1.5
         const maxLen = this._dArray.vertex.maxLength(); // directedEdge should used it by now.
         this.setBufferW(null, 0, expandAllocLen(maxLen+size) );
      }
      
      const start = this._wEdgeArray.edge.appendRangeNew(size);
      this._wEdgeArray.sharpness.appendRangeNew(size);
      return start;
   }

   /**
    * to be used by subdivision. next level block allocation.
    * 
    */
   _allocHEdge(size) {
      if (this._hArray.next.capacity() < size) {   // not enough blockLength
         const maxLen = this._hArray.next.maxLength();
         this.setBufferB(null, 0, expandAllocLen(maxLen+size) );
      }
      
      const index = this._hArray.vertex.appendRangeNew(size);
      this._hArray.next.appendRangeNew(size);
      this._hArray.prev.appendRangeNew(size);
      this._hArray.next.appendRangeNew(size);
      this._hArray.hole.appendRangeNew(size);
      this._hArray.wEdge.appendRangeNew(size);
      return index;
   }
   
   _freeWEdge(wEdge) {
      throw("no implementation yet");
   }
   
   //allocBoundaryEdge(size) {
   //   return this._allocHalfEdge(0, size, true);
   //}
   
   allocBoundaryEdge(handle) {
      const length = handle.length;
      const free = this._allocHalfEdge(0, length, true);
      return free;
   }
   
   freeBoundaryEdge(hEdge) {
      this.freeHalfEdge(hEdge);
   }
   
   _allocDirectedEdge(hEdge, length) {
      if (this._dArray.vertex.capacity() < length) {
         let maxLen = this._dArray.vertex.maxLength();
         maxLen = expandAllocLen(maxLen+length);
         this.setBuffer(null, 0, maxLen, computeDataTextureLen(Math.floor(maxLen/3*2)) );   // TODO: What the optimal wEdge expansion size? 
      }
            
      let handle = [];
      if (hEdge >= this._dArray.vertex.length()) { // asking for new one, hEdge === length().
         this._allocEx(length);
      } 
      for (let i = hEdge; i < (hEdge+length); ++i) {
         handle.push( i );
      }
      return handle;
   }
   
   /**
    * return 
    * used by nGon and boundaryHole already connected together. 
    * boundaryEdge is cw, nGon is ccw.
    */
   _allocHalfEdge(faceHole, size, isCW) {
      let nextArray = this._hArray.next;
      let prevArray = this._hArray.prev;
      if (isCW) { // reverse direction
         nextArray = this._hArray.prev;
         prevArray = this._hArray.next;
      }
      const head = [];
      let prev, next;
      while (--size >= 0) {
         if (this._fmm.hArray.size) { // get from free boundaryEdge first
            next = this._fmm.hArray.head;
            const nextNext = this._hArray.next.get(-(next+1), 0);
            this._fmm.hArray.head = nextNext;
            this._fmm.hArray.size--;
            // remember to init hole to faceHole
            this._hArray.hole.set(-(next+1), 0, faceHole);
         } else { // allocated a new one. return negative handle.
            const index = this._allocHEdge(1);
            this._hArray.hole.set(index, 0, faceHole);         // init faceHole value.
            this._hArray.vertex.set(index, 0, -1);
            next = -(index+1);
         }
         // setup prev/next connecting pointer.
         if (prev) {
            nextArray.set(-(prev+1), 0, next);
            prevArray.set(-(next+1), 0, prev);
         }
         prev = next;
         head.push( next );
      }
      // now connecting head and tail, 
      nextArray.set(-(next+1), 0, head[0]);
      prevArray.set(-(head[0]+1), 0, next);
      
      return head;
   }
   
   freeHalfEdge(hEdge) {  // add to freeList.
      this._fmm.hArray.size++;
      const nextNext = this._fmm.hArray.head;
      this._hArray.vertex.set(-(hEdge+1), 0, -1);
      this._hArray.hole.set(-(hEdge+1), 0, 0);              // reset as free.
      this._hArray.next.set(-(hEdge+1), 0, nextNext);
      this._fmm.hArray.head = hEdge;                        // fEdge is now head of freeList
   }
   
   //
   // remove hole, make the buffer contiguous. 
   // boundaryLoop make it contiguous too.
   //
   compactBuffer() {
      if (this._mesh.o.length() === 0) {
         return;
      }
      
      const size = this._hArray.vertex.length();
      // new buffer
      const hArray = {
         vertex: Int32PixelArray.create(1, 1, size),           // point to vertex.
         pair: Int32PixelArray.create(1, 1, size),             // twin/pair
         prev: Int32PixelArray.create(1, 1, size),             // negative value to hEdge
         next: Int32PixelArray.create(1, 1, size),             // negative value
         hole: Int32PixelArray.create(1, 1, size),             // negative value to hole, positive to nGon(QuadEdgeArray). 0 for empty
         wEdge: Int32PixelArray.create(1, 1, size),            // point back to wEdge if any
      };
      // do allocation
      const totalBytes = totalStructSize(hArray, size);
      const hArrayBuffer = allocBuffer(totalBytes);
      setBufferAll(hArray, hArrayBuffer, 0, size);
      for (let i in hArray) {
         hArray[i].appendRangeNew(size);
      }
      
      const boundaryArray = this._hArray;
      // redo boundaryLoop, one by one
      let i = 0;
      for (let hole of this._mesh.o) {
         let head = i;
         for (let dEdge of this._mesh.o.halfEdgeLoop(hole)) {   // walk over boundaryLoop
            const hEdge = -(dEdge+1);
            hArray.hole.set(i, 0, hole);
            hArray.next.set(i, 0, -(i+2));
            hArray.prev.set(i, 0, -i);
            hArray.vertex.set(i, 0, boundaryArray.vertex.get(hEdge, 0));
            const wEdge = boundaryArray.wEdge.get(hEdge, 0);
            hArray.wEdge.set(i, 0, wEdge);
            // fix pair
            let twin = boundaryArray.pair.get(hEdge, 0);
            this._dArray.pair.set(twin, 0, -(i+1));
            hArray.pair.set(i, 0, twin);
            // remember to update wEdge too
            const leftOrRight = wEdge % 2;
            this._wEdgeArray.edge.set(Math.trunc(wEdge/2), leftOrRight, -(i+1));
            i++;
         }
         // fix next, prev.
         hArray.next.set(i-1, 0, -(head+1));
         hArray.prev.set(head, 0, -i);             // -i = -(i-1+1)
         this._mesh.o.setHalfEdge(hole, -(head+1));
      }
      // dealloc extra.
      const extra = size - i;
      for (let i in hArray) {
         hArray[i].shrink(extra);
      }
 
      this._fmm.hArray.size = this._fmm.hArray.head = 0;
      // replace buffer
      this._hArray = hArray;
   }
   
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this._wEdgeArray.edge.length());
   }
   
   /**
    * walk over the wEdgeArray
    */
   * rangeIter(start, stop) {
      stop = Math.min(this._wEdgeArray.edge.length(), stop);
      let leftRight = [0, 0];
      for (let i = start; i < stop; i++) {
         const sharpness = this._wEdgeArray.sharpness.get(i, 0);
         if (sharpness >= 0) {  // existed.
            this._wEdgeArray.edge.getVec2(i, 0, leftRight);
            yield [i, leftRight[0], leftRight[1]];
         }
      }
   }

   //
   * halfEdgeIter() {
      yield this._directEdgeIter();
      yield this._nGonEdgeIter();
   }
   
   * boundaryIter() {
      const length = this._hArray.hole.length();
      for (let i = 0; i < length; ++i) {
         if (this._hArray.vertex.get(i, 0) >= 0) {    // in used
            if (this._hArray.hole.get(i, 0) >= 0) {   // negative is real face not hole.
               yield -(i+1);
            }
         }
      }
   }

   /**
    * direct access to the main directedEdge
    */
   * _directedEdgeIter() {
      for (let i = 0; i < this._dArray.vertex.length(); ++i) {
         if (this._dArray.vertex.get(i, 0) >= 0) {
            if (!this.isFree(i)) {
               yield i;
            }
         }
      }
   }
         
   /**
    * provide for compatiblity with QuadEdgeArray
    */
   * _nGonEdgeIter() {}

   /**
    * work through all the halfEdge, boundary, nGon, freed face.
    */
   * _bEdgeIter() {
      for (let i = 0; i < this._hArray.hole.length(); ++i) {
         yield -(i+1);
      }
   }

   isBoundary(dEdge) {  // not true for Quad, needs to override
      return (dEdge < 0);
   }

   hole(hEdge) {
      if (hEdge < 0) {
         return this._hArray.hole.get(-(hEdge+1), 0);
      } else {
         throw("bad boundaryEdge");
      }
   }

   setHole(hEdge, hole) {
      if (hEdge < 0) {
         this._hArray.hole.set(-(hEdge+1), 0, hole);
      } else {
         throw("bad boundaryEdge");
      }
   }
   
   linkNext(hEdge, next) {
      if ((hEdge < 0) && (next < 0)) {
         this._hArray.next.set(-(hEdge+1), 0, next);
         this._hArray.prev.set(-(next+1), 0, hEdge);
      } else {
         throw("linkNext connecting non-boundary HalfEdge");
      }
   }   
   
   destination(hEdge) {
      return this.origin( this.next(hEdge) );   // next is better than pair because no lookup only computation in most cases.
   }
   
   /**
    * return incident vertex position.
    */
   origin(hEdge) {
      if (hEdge < 0) {
         return this._hArray.vertex.get(-(hEdge+1), 0);  
      } else {
         return this._dArray.vertex.get(hEdge, 0);
      }
   }
   
   setOrigin(hEdge, vertex) {
      if (hEdge < 0) {
         this._hArray.vertex.set(-(hEdge+1), 0, vertex);
      } else {
         this._dArray.vertex.set(hEdge, 0, vertex);
      }
   }

   pair(hEdge) {
      if (hEdge < 0) {
         return this._hArray.pair.get(-(hEdge+1), 0);
      } else {
         return this._dArray.pair.get(hEdge, 0);
      }
      /*
      let edge;
      if (hEdge < 0) {
         edge = this._hArray.wEdge.get(-(hEdge+1), 0);
      } else {
         edge = this._dArray.wEdge.get(hEdge, 0);
      }
      const position = (edge+1)%2;           // next is pair.
      const wEdge = Math.trunc(edge / 2);
      if (position === 0) {
         return this.wEdgeLeft(wEdge);
      } else {
         return this.wEdgeRight(wEdge);
      }*/
   }
      
   _wEdge(hEdge) {
      if (hEdge < 0) {
         return this._hArray.wEdge.get(-(hEdge+1), 0);
      } else {
         return this._dArray.wEdge.get(hEdge, 0);
      }
   }
   
   wEdge(hEdge) {
      return Math.trunc( this._wEdge(hEdge) / 2 );
   }
   
   isWEdgeLeft(hEdge) {
      return (this._wEdge(hEdge)+1) % 2;
   }
   
   isWEdgeRight(hEdge) {
      return this._wEdge(hEdge) % 2;
   }
   
   wEdgePair(wEdge) {
      const values = [0, 0];
      this._wEdgeArray.edge.getVec2(wEdge, 0, values);
      return values;
   }
   
   wEdgeLeft(wEdge) {
      return this._wEdgeArray.edge.get(wEdge, wEdgeK.left);
   }
   
   wEdgeRight(wEdge) {
      return this._wEdgeArray.edge.get(wEdge, wEdgeK.right);
   }
   
   _setHEdgeWEdge(hEdge, wEdgePosition, pair) {
      if (hEdge < 0) {
         this._hArray.wEdge.set(-(hEdge+1), 0, wEdgePosition);
         this._hArray.pair.set(-(hEdge+1), 0, pair);
      } else {
         this._dArray.wEdge.set(hEdge, 0, wEdgePosition);
         this._dArray.pair.set(hEdge, 0, pair);
      }
   }
   
   _computeLeftRight(hEdge, pair) {
      // make sure small index is on the left, consistency
      if (hEdge < pair) {
         return [hEdge, pair];
      } else {
         return [pair, hEdge];
      }
      /*
      // make sure lower index is the left qEdge(except for boudnary and polyg), consistency helps in various way   
      if ((hEdge >= 0) && (pair >= 0)) { // normal case.
         if (hEdge > pair) {
            return [pair, hEdge];
         }
      } else if ((hEdge < 0) && (pair < 0)) {   // check which one is boundary
         if (this.isBoundary(hEdge)) {
            return [pair, hEdge];
         }
      } else { // either one is negative.
         if (hEdge < 0) {
            return [pair, hEdge];
         }
      }
      return [hEdge, pair];*/
   }
   
   _setWEdge(wEdge, left, right) {
      this._wEdgeArray.edge.setVec2(wEdge, 0, [left, right]);//this._computeLeftRight(left, right));
   }
   
   setWEdge(wEdge, left, right) {
      [left, right] = this._computeLeftRight(left, right);
      // reset all
      this._setHEdgeWEdge(left, wEdge * 2 + wEdgeK.left, right);
      this._wEdgeArray.edge.set(wEdge, wEdgeK.left, left);
      this._setHEdgeWEdge(right, wEdge * 2 + wEdgeK.right, left);
      this._wEdgeArray.edge.set(wEdge, wEdgeK.right, right);
   }
   
   /**
    * get sharpness from wEdge sharpness.
    * @param {int} dEdge 
    */
   sharpness(dEdge) {
      const wEdge = this.wEdge(dEdge);
      return this.wSharpness(wEdge);
   }

   wSharpness(wEdge) {
      return this._wEdgeArray.sharpness.get(wEdge, 0);
   }

   setSharpness(dEdge, sharpness) {
      const wEdge = this.wEdge(dEdge);
      this.setwSharpness(wEdge, sharpness);
   }

   setwSharpness(wEdge, sharpness) {
      this._wEdgeArray.sharpness.set(wEdge, 0, sharpness);
   }
   
   stat() {
      return "WholeEdge Count: " + this.lengthW() + ";\nDirectedEdge Count: " + this.length() + ";\n";
   }
   
   length() {
      return this._dArray.wEdge.length();      // NOTE: what about freed? will tried to compact() after every operation. 
   }
   
   lengthW() {
      return this._wEdgeArray.edge.length() - this._fmm.wEdgeArray.size;
   }
   
   lengthH() {
      return (this._hArray.wEdge.length() - this._fmm.hArray.size);
   }

   sanityCheck() {
      let length = this._wEdgeArray.edge.length();
      for (let i = 0; i < length; ++i) {
         const [left,right] = this.wEdgePair(i);
         if (left > right) {
            console.log("wEdge left is larger than right");
         }
         let wEdge = this.wEdge(left);
         if (wEdge !== i) {
            console.log("hEdge's wEdge("+ i +") disagree about wEdge's left("+ left +")'s wEdge ("+ wEdge +")");
            return false;
         }
         wEdge = this.wEdge(right);
         if (wEdge !== i) {
            console.log("hEdge's wEdge("+ i +") disagree about wEdge's right("+ right +")");
            return false;
         }
      }
      // check hArray.freed
      let freeCount = 0;
      let current = this._fmm.hArray.head;
      while (current < 0) {
         current = this._hArray.next.get(-(current+1), 0);
         freeCount++;
      }
      if (freeCount !== this._fmm.hArray.size) {
         console.log("FreeCount disagree, expected: " + this._fmm.hArray.size + " got: " + freeCount);
         return false;
      }
      return true;
   }
   
   //
   // convenient utility functions for adding dynamic uv(index).
   //
   static addUV(halfEdgeArray, index=0) {
      const type = {
         className: 'Float16PixelArray',
         sizeOf: 2,
         numberOfChannel: 2,
         initialSize: halfEdgeArray.length(),
         fields: {
            U: [0, 1],                    // [position, size]
            V: [1, 1],
            UV: [0, 2],
         }
      }
      return halfEdgeArray.addProperty(`uv${index}`, type);
   }
}




class FaceArray {
   constructor(materialDepot, array, fmm) {
      this._depot = materialDepot;
      this._array = array;
      this._fmm = fmm;        // freed array slot memory manager.
      this._prop = {};
   }

   static _rehydrateInternal(self) {
      const array = rehydrateObject(self._array);
      const fmm = self._fmm;
      return [null, array, fmm];   // FixMe: no depot for now
   }

   static _createInternal(depot, size) {
      const array = {
         material: Int32PixelArray.create(1, 1, size),
      };
      const fmm = {
         size: 0,
         head: 0,
      };
      return [depot, array, fmm];
   }

   getDehydrate(obj) {
      obj._array = dehydrateObject(this._array);
      obj._fmm = this._fmm;
      return obj;
   }
   
   /**
    * given length(number of faces), return the required memory size.
    * 
    */
   computeBufferSize(length) {
      return totalStructSize(this._array, length)
            + totalStructSize(this._prop, length);
   }
   
   /**
    * update all 
    */
   setBuffer(bufferInfo, byteOffset, length) {
      if (!bufferInfo) {
         bufferInfo = allocBuffer(this.computeBufferSize(length));
         byteOffset = 0;
      }
      
      byteOffset = setBufferAll(this._array, bufferInfo, byteOffset, length);
      return setBufferAll(this._prop, bufferInfo, byteOffset, length);
   }
   
   addProperty(name, type) {
      //if (isValidVarName(name)) {
         if (this._prop[name] === undefined) { // don't already exist
            // create DynamicProperty for accessing data
            this._prop[name] = createDynamicProperty(type, this.length());
            return this._prop[name];
         }
      //}
      return false;
   }
   
   getProperty(name, index) {
      if (index === undefined) {
         return this._prop[name];
      } else {
         return this._prop[name][index];
      }
   }
   
   removeProperty(name) {
      if (this._prop[name]) {
         delete this._prop[name];
         return true;
      }
      return false;
   }   
   
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this.length());
   }

   * rangeIter(start, stop) {
      stop = Math.min(this.length(), stop);
      for (let i = start; i < stop; i++) {
         yield i;
      }
   }
   
   * vertexLoop(face) {
      for (const hEdge of this.halfEdgeLoop(face)) {
         yield this._mesh.h.origin(hEdge);
      }
   }
   
   /* * wEdgeLoop(face) {
   }*/
   
   * faceAround(face) {
      for (let [hEdge, neighborFace] of this.faceAroundEntries(face)) {
         yield neighborFace;
      }
   }
   
   * faceAroundEntries(face) {
      for (const hEdge of this.halfEdgeLoop(face)) {
         const pair = this._mesh.h.pair(hEdge);
         if (pair >= 0) { // we want face not hole
            yield [hEdge, this._mesh.h.face(pair)];
         }
      }
   }
   
   length() {
      return (this._array.material.length());
   }
   
   /**
    * allocated directly from _array without checking freeList
    */
   _allocEx(size) {
      if (this._array.material.capacity() < size) { // resize array if not enough free space.
         this.setBuffer(null, 0, expandAllocLen( this._array.material.maxLength()+size ) );
      }
      
      const start = this._array.material.length();
      this._array.material.appendRangeNew(size);
      return start;
   }
      
   alloc(material) {
      let handle;
      if (this._fmm.size > 0) {
         handle = this._fmm.head;
         this._fmm.head = this._array.material.get(handle, 0);
         --this._fmm.size;
      } else {    // increment Face Count.
         handle = this._allocEx(1);       // this._array.material.alloc(); this._array.color.alloc();
      }
      if (material == null) {
         material = this._depot.getDefault();
      }
      this.setMaterial(handle, material);
      this._depot.addRef(material, 1);
      return handle;
   }
   
   freeFace(fHandle) {
      
   }
   
   setHalfEdge(handle, hEdge) {  // implicit halfEdge, no needs to set
      throw("cannot set Face's halfEdge");
   }
   
   createMaterialTexture(gl) {
      return this._array.material.createDataTexture(gl);
   }
      
   _materialAddRef(material, count) {
      this._depot.addRef(material, count);
   }
   
   material(polygon) {
      return this._array.material.get(polygon, 0);
   }
   
   _setMaterial(polygon, material) {
      this._array.material.set(polygon, 0, material);
   }

   setMaterial(polygon, material) {
      let oldMaterial = this.material(polygon);
      if (oldMaterial !== material) {
         this._setMaterial(polygon, material);
         this._depot.addRef(material, 1);
         this._depot.releaseRef(oldMaterial, 1);
      }
   }

/* DELETED: replaced by custom property  
   color(polygon, color) {
      this._array.color.getVec4(polygon, 0, color);
      return color;
   }

   setColor(polygon, color) {
      this._array.color.setVec4(polygon, 0, color);
   } */
   
      
   sanityCheck(dEdges) {   // halfEdge and Triangle are align automatically, always true.
      for (let face of this) {
         for (let hEdge of this.halfEdgeLoop(face)) {
            const pair = this._mesh.h.pair(hEdge);
            //if (this._mesh.h.isBoundary(pair)) {
            //   console.log("polygon: " + face + " has boundary: " + pair + " on hEdge: " + hEdge);
            //}
         }
      }
      return true;
   }
   
/*   stat() {
      return "Polygon Count: " + this.length() + ";\n";
   } */
}



/**
 * BoundaryLoop aka HoleArray
 */
class HoleArray {
   constructor(holes) {
      this._mesh = null;
      this._holes = holes;
      this._fmm = {
         size: 0,
         head: 0,
      };
   }

   static create(buffer, byteOffset, length) {
      const holes = Int32PixelArray.create(1, 1);
      holes.appendNew();    // zeroth hole is reserved for sentinel purpose.
      return new HoleArray(holes);
   }

   static rehydrate(self) {
      if (self._holes) {
         return new HoleArray(rehydrateBuffer(self._holes));
      }
      throw("HoleArray _rehydrateInternal: bad input");
   }

   getDehydrate(obj) {
      obj._holes = this._holes.getDehydrate({});
      obj._fmm = this._fmm;
      return obj;
   }
   
   // 
   // given items length, compute the number of bytes needs
   // int32(4 bytes) * length.
   //
   computeBufferSize(length) {
      if (length) {
         return this._holes.computeBufferSize(length+1);    // added sentinel
      }
      return 0;
   }
   
   setBuffer(bufferInfo, byteOffset, length) {
      if (length) {
         length++;                                          // remember to add sentinel
      }
      
      if (!bufferInfo) {
         bufferInfo = allocBuffer(this.computeBufferSize(length));
         byteOffset = 0;
      }
      
      return this._holes.setBuffer(bufferInfo, byteOffset, length);
   }

   /**
    * assumed this is pristine, reconstruct hole from another one, used by subdivide.
    * @param {HoleArray} src
    */
   _copy(src) {
      const srcLen = src._holes.length();
      this._holes.appendRangeNew(srcLen - this._holes.length());
      // now copy everything.
      for (let i = 0; i < srcLen; ++i) {
         this._holes.set(i, 0, src._holes.get(i, 0));
      }
   }
   
   length() {
      return this._holes.length()-1;
   }
   
   *[Symbol.iterator] () {
      const len = this._holes.length();
      for (let i = 1; i < len; ++i) {  // skipped 0, it sentinel
         if (!this._isFree(i)) {
            yield i;
         }
      }
   }

   * halfEdgeLoop(hole) {
      const hEdges = this._mesh.h;
      const start = this.halfEdge(hole);
      let current = start;
      do {
         yield current;
         current = hEdges.next(current);
      } while (current !== start);
   }

   _hasFree() {
      return (this._fmm.size > 0);
   }
   
   //
   // allocated directly from _array without checking free
   _allocEx(size) {
      const start = this._holes.length();
      this._holes.appendRangeNew(size);
      return start;
   }

   alloc() {
      // check free list first,
      if (this._hasFree()) {
         return this._allocFromFree();
      } else {
         if (this._holes.capacity() < 1) {
            this.setBuffer(null, 0, expandAllocLen(this._holes.maxLength()) );
         }
         
         let handle = this._holes.appendNew();
         return handle;
      }
   }

   free(handle) {
      if (handle > 0) {
         this._addToFree(handle);
      }
   }
   
   /**
    * halfEdge is negative Int, so freeList using positive Int
    * @param {negative Int} hole 
    * @returns {bool}
    */
   _isFree(hole) {
      const hEdge = this._holes.get(hole, 0);
      return (hEdge >= 0);
   }
      
   /** 
    * freeList is using positive Int because HalfEdge is negative Int.
    * @return {negative Int} hole.
    */
   _allocFromFree() {
      let head = this._holes.get(1, 0);
      const newHead = this._holes.get(head, 0);
      this._holes.set(1, 0, newHead);
      this._holes.set(0, 0, this._holes.get(0,0)-1);   // update freecount;
      return head;
   }

   /** 
    * freeList is using positive Int because HalfEdge is negative Int.
    * @param {negative Int} hole.
    */
   _addToFree(hole) {
      // return to free list
      const oldHead = this._get(1, 0);
      this._holes.set(-hole, 0, oldHead);
      this._holes.set(1, 0, -hole);
      this._holes.set(0, 0, this._holes.get(0,0)+1);   // update freecount;
   }

   halfEdge(handle) {
      if (handle > 0) {
         return this._holes.get(handle, 0);
      } else {
         throw("invalid hole: " + handle);
      }
   }

   setHalfEdge(handle, hEdge) {
      if (handle > 0) {
         this._holes.set(handle, 0, hEdge);
      } else {
         throw("invalid hole: " + handle);
      }
   }

   sanityCheck() {
      const hEdges = this._mesh.h;
      let sanity = true;
      for (let hole of this) {
         for (let hEdge of this.halfEdgeLoop(hole)) {
            if (hEdges.hole(hEdge) !== hole) {
               sanity = false;
               break;
            }
         }
      }
      return sanity;
   }

   stat() {
      return "Holes Count: " + (this._holes.length()-1-this._fmm.size) + ";\n";
   }
}



/**
 * name group for collection of faces.
 */
class NameGroup {
   constructor(name, start) {
      this._name = name;
      this._faces = {start: start, end: start+1};    // restriction to continus faces, should be an array of faces to be more flexible.
   }

   finalize(end) {
      //this._faces.start = start;
      this._faces.end = end;
   }
}



/** 
 * abstract class representing Mesh. base SurfaceMesh, managing material,
 * vertex, hEdge, face, and boundaryLoop.
 */
class SurfaceMesh {
   constructor(hEdges, vertices, faces, holes, bin, material) {
      this._bin = bin;
      this._material = material;
      this._hEdges = hEdges;
      this._hEdges._mesh = this;
      this._vertices = vertices;
      this._faces = faces;
      this._faces._mesh = this;
      this._holes = holes;
      this._holes._mesh = this;
   }

   static _createInternal(materialDepot) {
      const bin = {nameGroup:[], };

      const material = {depot: materialDepot};
      const warehouse = new Map
      material.used = warehouse;
      material.proxy = {                    // TODO: use real proxy?
         *[Symbol.iterator] () {
            yield* warehouse;
         },

         addRef: (material, count)=> {
            materialDepot.addRef(material, count);
            let oldCount = warehouse.get(material);
            if (oldCount === undefined) {
               oldCount = 0;
            }
            warehouse.set(material, oldCount + count);
         },

         releaseRef: (material, count)=> {
            materialDepot.releaseRef(material, count);
            let oldCount = warehouse.get(material);
            count = oldCount - count;
            if (count) {
               warehouse.set(material, count);
            } else {
               warehouse.delete(material);
            }
         },

         getDefault: ()=> {
            return materialDepot.getDefault();
         },
      };

      return [bin, material];
   }
   
   static _rehydrateInternal(self) {
      // nothing, we are only interested in geometry data.
      return [null, null];
   }

   getDehydrate(obj) {
      // get nothing because subdivide don't use it? material?
      return obj;
   }
   
   /**
    *  reserve pixel array capacity for static mesh. for dynamic reserve individually.
    * @param {int} nVertices - number of vertices
    * @param {int} nWEdges = number of WhlEdges
    */
   reserve(nVertices, nWEdges, nHfEdges, nBoundaries, nFaces, nHoles, isStatic=true) {
      // padded to rectData dimension.
      nVertices = computeDataTextureLen(nVertices);
      nWEdges = computeDataTextureLen(nWEdges);
      nHfEdges = computeDataTextureLen(nHfEdges);
      nBoundaries = computeDataTextureLen(nBoundaries);
      nFaces = computeDataTextureLen(nFaces);
      nHoles = computeDataTextureLen(nHoles);
      
      if (isStatic) {
         const totalBytes = this._vertices.computeBufferSize(nVertices)
                          + this._hEdges.computeBufferSizeAll(nHfEdges, nBoundaries, nWEdges)
                          + this._faces.computeBufferSize(nFaces)
                          + this._holes.computeBufferSize(nHoles);
      
         // reserve total linear memory
         const newBuffer = allocBuffer(totalBytes);
         // set new buffer and copy over if necesary.
         let byteOffset = this._vertices.setBuffer(newBuffer, 0, nVertices);
         //console.log("offset: " + byteOffset);
         byteOffset = this._hEdges.setBufferAll(newBuffer, byteOffset, nHfEdges, nBoundaries, nWEdges);
         //console.log("offet: " + byteOffset);
         byteOffset = this._faces.setBuffer(newBuffer, byteOffset, nFaces);
         //console.log("offset: " + byteOffset);
                      this._holes.setBuffer(newBuffer, byteOffset, nHoles);
      } else { // reserve linear memory separately for dynamic resizing
         this._vertices.setBuffer(null, 0, nVertices);
         this._hEdges.setBufferAll(null, 0, nHfEdges, nBoundaries, nWEdges);
         this._faces.setBuffer(null, 0, nFaces);
         this._holes.setBuffer(null, 0, nHoles);
      }
   }
   
   /**
    * simple wrapper for VertexArray.inHalfEdgeAround()
    */
   inHalfEdgeAroundVertex(vert) {
      return this._vertices.inHalfEdgeAround(this._hEdges, vert);
   }
   
   /**
    * simple wrapper around VertexArray.outHalfEdgeAround()
    */
   outHalfEdgeAroundVertex(vert) {
      return this._vertices.outHalfEdgeAround(this._hEdges, vert);
   }
   
   /**
    * free unused memory from all the pixel's array.
    * TODO: 
    */
   shrink() {
      
   }
  
   get f() {
      return this._faces;
   }
   
   get h() {
      return this._hEdges;
   }
   
   get v() {
      return this._vertices;
   }

   get o() {
      return this._holes;
   }

   get m() {
      return this._material.proxy;
   }
   
   makePullBuffer(gl) {
      //this.v.computeNormal(this.h);
   
      const vertexTexture = this.h.createVertexTexture(gl);
      const positionTexture = this.v.createPositionTexture(gl);
      const normalTexture = this.v.createNormalTexture(gl);
      const uvsTexture = this.h.createPropertyTexture('uv0', gl);
      
      const pbrTexture = this._material.depot.createTexture(gl);
      const materialTexture = this.f.createMaterialTexture(gl);
      
/*      const materials = [];
      for (let [handle, count] of this._material.used) {
         materials.push( this._material.depot.getUniforms(handle) );
      }*/
      
      return {pullLength: this.h.length(),
              vertex: {type:"isampler2D", value: vertexTexture},
              position: {type:"sampler2D", value: positionTexture}, 
              normal: {type:"sampler2D", value: normalTexture},
              uvs: {type: "sampler2DArray", value: uvsTexture},
              pbr: {type: "sampler2D", value: pbrTexture},
              material: {type: "sampler2D", value: materialTexture},
             };
   }
   
   //
   // post process,
   // compacting internal array, no freed slots in array.
   // required for subdivision.
   // returned changed position.
   //
   compactBuffer() {
      const changed = {};
      //changed.v = this.v.compactBuffer();
      //changed.f = this.f.compactBuffer();
      changed.h = this.h.compactBuffer();
      
      return changed;
   }

   // post process
   // fill boundaryLoop with holes.
   fillBoundary() {
      // walk through all boundaryEdge, assign hole to each boundary group. 
      for (let boundary of this._hEdges.boundaryIter()) {
         let hole = this._hEdges.hole(boundary);
         if (hole === 0) {   // unassigned hEdge, get a new Hole and start assigning the whole group.
            hole = this._holes.alloc();
            this._holes.setHalfEdge(hole, boundary);
            // assigned holeFace to whole group
            let current = boundary;
            do {
               this._hEdges.setSharpness(current, -1);   // boundary is infinite crease.
               this._hEdges.setHole(current, hole);
               current = this._hEdges.next(current);
            } while (current !== boundary);
         }
      }
   }
   
   /**
    * finalized meshes, filled holes, compute crease, valence
    * editDone() - post process
    */
   doneEdit() {
      this.fillBoundary();
      // now compute valence, crease 
      this.v.computeValence(this.h);
      this._computeNormal();       // and normal?
      // commpaction
      this.compactBuffer();
   }
      
   addNameGroup(name, start) {
      let ret = new NameGroup(name, start);
      this._bin.nameGroup.push( ret );
      return ret;
   }
      
   addVertex(inPt, inOffset=0) {
      // Todo: check free first

      const v = this.v;
      // allocated from both pt and vertex
      const vertex = v.alloc();
      v.setValence(vertex, -1);              // valence(-1) for unitialized yet.
      v.copyPt(vertex, inPt, inOffset);
      return vertex;
   }
   
   addFace(pts, material) {
      return this.addFaceEx(0, pts.length, pts, material);
   }
   
   findHalfEdge(v0, v1) {
      for (let outEdge of this._vertices.outHalfEdgeAround(this._hEdges, v0)) {
         if (this._hEdges.destination(outEdge) === v1) {
            return outEdge;
         }
      }
      return -1;
   }
   
 /**
     merging 2 opposite but same boundaryedge. a is paired boundaryEdge,
     * b is not yet paired.
   */
   _collapseEdge(a, b) {
      const c = this._hEdges.pair(a);     // get the real halfEdge
      //let d = this._hEdges.pair(b);
      // now safely reassigned
      //this._hEdges.setPair(c, d);
      this._hEdges.freeBoundaryEdge(a);
      this._hEdges.freeBoundaryEdge(b); 
      return c;
   }
   
   /**
    * assume normal triangle.
    * @param {*} start 
    * @param {*} end 
    * @param {*} pts 
    * @returns {number, array} - {face, halfLoop}
    */
   addFaceEx(start, end, pts, material) {
      const length = end - start;
          
      // create Polygon directEdge
      const newPoly = this._allocPolygon(material, length);
      const polyLoop = this._faces.halfEdgeLoopArray(newPoly);
      const boundaryLoop = this._hEdges.allocBoundaryEdge(polyLoop);
      
      let nextIndex = start;
      // find splice freeEdge point.
      const halfLoop = [];
      const freeEdges = [];
      for (let i = start; i < end; ++i) {
         nextIndex = i + 1;
         if (nextIndex === end) {
            nextIndex = start;
         }

         let v0 = pts[i];
         let v1 = pts[nextIndex];
         let [found, edge] = this.findFreeEdge(v0, v1);   // try to find matching freeIn
         if (found && edge >= 0) {  // not finding free edge,
            this._freePolygon(newPoly);
            // This half-edge would introduce a non-manifold condition.
            console.log("non-manifold condition");
            return {success: false};
            // should we rewinded the newly created wholeEdge? currently nay.
         } else { // yes free Edge for insertion.
            halfLoop.push( edge );
            if (!found) { // insertion point,
               edge = 0;
            }
            freeEdges.push(edge);
         }
      }

      // yeah, we needs to make (in,out) adjacent to properly merge.
      for (let i = 0; i < length; ++i) {
         let next = (i+1) % length;
         if (freeEdges[i] < 0 && freeEdges[next] < 0) {
            this.makeAdjacent(freeEdges[i], freeEdges[next]);
         }
      }
      
      // we have to merge boundary first. Insert to gap first will make merging much more complicated
      for (let i = 0; i < length; ++i) {

         this._hEdges.setOrigin(polyLoop[i], pts[i+start]);
         let a = freeEdges[i];
         if (this._hEdges.isBoundary(a)) {    // has collapsible pairing free edge
            halfLoop[i] = 1;
            halfLoop[(i+1)%length] = 1;  // yes, handle too.
         
            let b = boundaryLoop[i];      // pair(polyLoop[i]);
         
            let c = this._hEdges.next(a);
            let d = this._hEdges.prev(b);
            // check head for pairing and collapse
            if ( c !== b ) { // not already collapsed
               this._hEdges.linkNext(a, b);
               this._hEdges.linkNext(d, c);
            } 
            
            // check tail for pairing and collapse
            c = this._hEdges.prev(a);
            if (c !== b) { // not already collapsed
               d = this._hEdges.next(b);
               this._hEdges.linkNext(b, a);
               this._hEdges.linkNext(c, d);
            }
            
            // now safely remove the freed-pair, and connect the 2 tri
            c = this._collapseEdge(a, b);
            let wEdge = this._hEdges.wEdge(c);           // use pair's allocated wEdge.
            this._hEdges.setWEdge(wEdge, polyLoop[i], c);
         } else {// remember to allocated a new wEdge.
            const pair = boundaryLoop[i];                //this._hEdges.pair( polyLoop[i] );
            this._hEdges.allocWEdge(polyLoop[i], pair);
            this._hEdges.setOrigin( pair, pts[start+(i+1)%length]); // remember to set pair's(freeEdge) vertex too
         }
      }      
      
      // now insert to gap for the rest of the triangle edges.
      for (let i = 0; i < length; ++i) {
         //this._hEdges.setOrigin(polyLoop[i], pts[i+start]);   // already set in merging step
         let a = halfLoop[i];
         if (a === 0) { // isolated vertex, so just point forth and back
            this._vertices.setHalfEdge(pts[i+start], polyLoop[i]);
         } else if (this._hEdges.isBoundary(a)) {  // no prevCollapse(spliced), so splice in triangle edge here.         
            let b = boundaryLoop[i];               //this._hEdges.pair(polyLoop[i]);
            let c = this._hEdges.prev(a);
            let d = this._hEdges.next(b);
                
            this._hEdges.linkNext(b, a);
            this._hEdges.linkNext(c, d);
         }
      }

      return {face: newPoly, hLoop: polyLoop, success: true};
   }

   
   /**
      try to find the matching boundary pair if any,
   */
   findFreeEdge(v0, v1) {
      let freeEdge = 0;
      for (let outEdge of this.outHalfEdgeAroundVertex(v0)) {
         if (this._hEdges.destination(outEdge) === v1) {
            if (!this._hEdges.isBoundary(outEdge)) {  // non-free
               return [true, 1];
            }
            return [true, outEdge];
         } else if (this._hEdges.isBoundary(outEdge)) {
            freeEdge = outEdge;
         }
      }
      // return not-found, append after freeEdge if applicable
      return [false, freeEdge];
   }

   /**
    * search for free gap,
    * @see {@link http://kaba.hilvi.org/homepage/blog/halfedge/halfedge.htm}
    * @param {integer} inner_next - next index of gap  
    * @param {integer} inner_prev - prev index of gap
    * @returns {integer} - the gap index, or -1 if not founded.
    */
   findFreeInEdge(inner_next, inner_prev) {
      const hEdges = this.h;
      const startingFrom = hEdges.pair(inner_next);
      const andBefore = inner_prev;
      if (andBefore !== startingFrom) {
         let current = startingFrom;
         do {
            if (hEdges.isBoundary(current)) {
               return [true, current];
            }
            current = hEdges.pair( hEdges.next(current) );
         } while (current !== andBefore);
      }

      console.log("SurfaceMesh.addFace.findFreeInEdge: patch re-linking failed");
      return [false, 0];
   }
   
   makeAdjacent(inEdge, outEdge) {
      const hEdges = this.h;
      if (hEdges.next(inEdge) === outEdge) {   // adjacency is already correct.
         return true;
      }

      const b = hEdges.next(inEdge);
      const d = hEdges.prev(outEdge);

      // Find a free incident half edge
      // after 'out' and before 'in'.
      const [freeIn, g] = this.findFreeInEdge(outEdge, inEdge);

      if (!freeIn) {
         console.log("BaseMesh.spliceAjacent: no free inEdge, bad adjacency");
         return false;
      } else if (g === d) {
         hEdges.linkNext(inEdge, outEdge);
         hEdges.linkNext(d, b);
      } else {
         const h = hEdges.next(g);

         hEdges.linkNext(inEdge, outEdge);

         hEdges.linkNext(g, b);

         hEdges.linkNext(d, h);
      }
      return true;
   }  
   
   _allocPolygon(material, side) {
      const handle = this._faces.alloc(material, side);
      this._hEdges.alloc(side, handle);
      return handle;
   }
   
   _freePolygon(faceHndl) {
      //this._;
      
   }
    
   sanityCheck() { 
      const hOk = this.h.sanityCheck();
      const vOk = this.v.sanityCheck(this.h);
      const fOk = this.f.sanityCheck();
      const oOk = this.o.sanityCheck();
      return (vOk && hOk && fOk && oOk);
   }
   
   stat() {
      let status = this.v.stat();
      status += this.h.stat();
      status += this.f.stat();
      status += this.o.stat();
      return status;
   }  
      
   isEmpty() {
      return (this.v.length() === 0) && (this.f.length() === 0);
   }
}

export {
   VertexArray,
   HalfEdgeArray,
   FaceArray,
   HoleArray,
   SurfaceMesh,
}
