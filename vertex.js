/**
 * VanillaVertexArray, 3d point-less structure, for EditableMesh
 * VertexArray, the workhorse.
 * 
 */

import {Int32PixelArray, Float32PixelArray, Uint8PixelArray, Float16PixelArray, rehydrateBuffer, allocBuffer, freeBuffer, ExtensiblePixelArrayGroup} from './pixelarray.js';
import {vec3, vec3a} from "./vec3.js";
import {expandAllocLen, computeDataTextureLen} from "./glutil.js";


/**
// hEdge: 
// pt: 
// normal: 
// color:
// valence: 
// crease:      // (-1=corner, 3 edge with sharpness), (0=smooth, (0,1) edge with sharpness), (>1 == crease, 2 edge with sharpness))
*/
class VanillaVertexArray extends ExtensiblePixelArrayGroup {
   constructor(base, props, freePool, valenceMax) {
      super(props, freePool);                 // base, and custom property
      this._hfEdge = base.hfEdge ?? null;
      this._valence = base.valence ?? null;
      this._valenceMax = valenceMax;
   }
   
   //*** used by ArrayGroup ***
   get _freeSlot() {
      return this._hfEdge;
   }
   
   * _baseEntries() {
      yield ["_hfEdge", this._hfEdge];
      yield ["_valence", this._valence];
   }
   //*** end of subclassing ArrayGroup ***
   
   static create(size) {
      const array = {
         hfEdge: Int32PixelArray.create(1, 1, size),              // point back to the one of the hEdge ring that own the vertex. 
         valence: Int32PixelArray.create(1, 1, size),
      };
      const freePool = {};                                        // use default stride=1, pos:0

      return new VanillaVertexArray(array, {}, freePool, 0);
   }
   
   _rehydrate(self) {
      if (typeof self._valenceMax !== 'undefined') {
         super._rehydrate(self);
         this._valenceMax = self._valenceMax;
      } else {
         throw("bad input");
      }
   }

   static rehydrate(self) {
      const ret = new VanillaVertexArray({}, {}, {}, 0);
      ret._rehydrate(self);
      return ret;
   }
   
   getDehydrate(obj) {
      super.getDehydrate(obj);
      obj._valenceMax = this._valenceMax;
      return obj;
   }
   
   
/*
   isFree(vertex) {
      return this._vertex.valence.get(vertex, 0) === 0;  // valence >= 3 for valid exit
   }
 */
   
   //
   // iterator start
   //
   
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this._hfEdge.length());
   }

   * rangeIter(start, stop) {
      stop = Math.min(this._hfEdge.length(), stop);
      for (let i = start; i < stop; i++) {
         // if (!isFree(i)) {
         yield i;
         //}
      }
   }
   
   * outHalfEdgeAround(hEdgeContainer, vert) {
      if (this._valence.get(vert, 0) > 0) {   // has outEdge?
         const start = this._hfEdge.get(vert, 0);
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
      if (this._valence.get(vert, 0) > 0) {   // has outEdge?
         const start = this._hfEdge.get(vert, 0);
         let current = start;
         do {
            const inEdge = hEdgeContainer.pair(current);
            current = hEdgeContainer.next( inEdge );
            yield inEdge;
         } while (current !== start);
      }
   }
   
   // faceAround(hEdges, vert)
   // vertexAround(hEdges, vert)
   // wEdgeAround(hEdges, vert)
   
   halfEdge(vert) {
      return this._hfEdge.get(vert, 0);
   }
   
   setHalfEdge(vert, hEdge) {
      this._hfEdge.set(vert, 0, hEdge);
      // when allocated, it should be initialized.
      let valence = this._valence.get(vert, 0);  // check for init
      if (valence <= 0) {
         this._valence.set(vert, 0, 1);
      }
   }
   
   // the maximum valence ever in this VertexArray.
   valenceMax() {
      return this._valenceMax;
   }
   
   valence(vertex) {
      return this._valence.get(vertex, 0);
   }
   
   setValence(vertex, valence) {
      this._valence.set(vertex, 0, valence);
   }

   // dummy, to be override, not natural position.
   setCrease(_vertex, _crease) {}

   computeValence(hEdgeContainer) {
      let valenceMax = 0;
      for (let i of this) {
         const start = this._hfEdge.get(i, 0);
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
      return "Vertices Count: " + this._hfEdge.length() + ";\n";
   }

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
   sizeOf: 4,
};
Object.freeze(PointK);

/**
// hEdge: 
// pt: 
// crease:      // (-1=corner, 3 edge with sharpness), (0=smooth, (0,1) edge with sharpness), (>1 == crease, 2 edge with sharpness))
// normal:
// color:
*/
class VertexArray extends VanillaVertexArray {
   constructor(array, props, freePool, valenceMax) {
      super(array, props, freePool, valenceMax);
      this._pt = array.pt ?? null;
   }
   
   * _baseEntries() {
      yield* super._baseEntries();
      yield ["_pt", this._pt];
   }
   
   static create(size) {
      const array = {
         hfEdge: Int32PixelArray.create(1, 1, size),              // point back to the one of the hEdge ring that own the vertex. 
         valence: Int32PixelArray.create(1, 1, size),         
         pt: Float32PixelArray.create(PointK.sizeOf, 4, size),    // pts = {x, y, z}, 3 layers of float32 each? or 
      };
      const prop = {
         color: Uint8PixelArray.create(4, 4, size),               // should we packed to pts as 4 channels(rgba)/layers of textures? including color?
         // cached value
         normal: Float16PixelArray.create(3, 3, size),
      };
      const freePool = {};                                        // use default

      return new VertexArray(array, prop, freePool, 0);
   }

   static rehydrate(self) {
      const ret = new VertexArray({}, {}, {}, 0);
      ret._rehydrate(self);
      return ret;
   }
   
   createPositionTexture(gl) {
      return this._pt.createDataTexture(gl);
   }
   
   createNormalTexture(gl) {
      return this._prop.normal.createDataTexture(gl);
   }
   
   positionBuffer() {
      return this._pt.getBuffer();
   }
   
   copyPt(vertex, inPt, inOffset) {
      vec3.copy(this._pt.getBuffer(), vertex * PointK.sizeOf, inPt, inOffset);
      //this._base.pt.set(vertex, 0, 0, inPt[inOffset]);
      //this._base.pt.set(vertex, 0, 1, inPt[inOffset+1]);
      //this._base.pt.set(vertex, 0, 2, inPt[inOffset+2]);
   }

   crease(vertex) {
      return this._pt.get(vertex, PointK.c);
   }

   setCrease(vertex, crease) {
      this._pt.set(vertex, PointK.c, crease);
   }
   
   /**
    * Loop bitangent scheme
    */
   computeLoopNormal(hEdgeContainer) {
      const tangentL = [0, 0, 0];
      const tangentR = [0, 0, 0];
      const temp = [0, 0, 0];
      const handle = {face: 0};
      const pt = this._pt.getBuffer();
      for (let v of this) {     
         const valence = this.valence(v);
         const radStep = 2*Math.PI / valence;
                  
         let i = 0;
         tangentL[0] = tangentL[1] = tangentL[2] = tangentR[0] = tangentR[1] = tangentR[2] = 0.0;
         for (let hEdge of this.outHalfEdgeAround(hEdgeContainer, v)) {
            let p = hEdgeContainer.destination(hEdge);
            let coseff = Math.cos(i*radStep);
            let sineff = Math.sin(i*radStep);
            vec3a.scaleAndAdd(tangentL, 0, pt, p * PointK.sizeOf, coseff);
            vec3a.scaleAndAdd(tangentR, 0, pt, p * PointK.sizeOf, sineff);
            i++;  // next face
         }
         // now we have bi-tangent, compute the normal
         vec3.cross(temp, 0, tangentL, 0, tangentR, 0);
         vec3a.normalize(temp, 0);
         this._prop.normal.setVec3(v, 0, temp);      
         
      }
   }

}


export {
   VanillaVertexArray,
   PointK,
   VertexArray,
}
