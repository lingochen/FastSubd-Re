/**
 * DirectedEdge instead of traditional HalfEdge. 
 * Same operation as HalfEdge, implicit next/prev and explicit pair data member.
 * Traditional HalfEdge is explicit next/prev but implicit pair data member.
 * AddFace() different logic from HalfEdge.
 * better cache coherence and more similar to traditional face/vertex representation.
 * easier to optimize for parallel subdivision.
 * Only triangle mesh here, general polygon is better handle by traditional HalfEdge. (2024/08/14)
 * 
 * directed edges for triangles(can be used for quads) only meshes. halfEdges with implicit triangles.
 * S. Campagna, L. Kobbelt, H.-P. Seidel, Directed Edges - A Scalable Representation For Triangle Meshes , ACM Journal of Graphics Tools 3 (4), 1998.
 * 
 * The idea of FreeEdge(boundary edge) is the key in making DirectedEdge works like HalfEdge. 
 * boundaryLoop is handle by negative value and separate array for pairing/next/prev traversal.
 * 
 * 
 * triangle ratio vertex(4):edge(5):triangle(3)
 * quad ratio vertex(4):edge(4):quad(2)
 * 
 * Provided 5 classes.
 * VertexArray
 * TriangleEdgeArray
 * TriangleArray
 * HoleArray
 * TriangleMesh
 * 
 * Note: Gino van den Bergen has an interesting implementation. http://www.dtecta.com/files/GDC17_VanDenBergen_Gino_Brep_Triangle_Meshes.pdf
 */
 

import {Int32PixelArray, Float32PixelArray, Uint8PixelArray, Float16PixelArray, allocBuffer, freeBuffer, PixelArrayGroup, ExtensiblePixelArrayGroup} from './pixelarray.js';
import {vec3, vec3a} from "./vec3.js";
import {expandAllocLen, computeDataTextureLen} from "./glutil.js";
import {VertexArray} from "./vertex.js";

// more than 2b, but less than 4b data support? 
//const UINT_MAX = 4294967295;
//let BOUNDARY_MAX = 16,777,215;                // 24bit max, around 16 million boundary edges. NOTE: Is it enough?
//let HALFEDGE_MAX = UINT_MAX - BOUNDARY_MAX;   // number of halfEdge we can use.


const wEdgeK = {
   left: 0,                      // pair directedEdge/halfEdge
   right: 1,
   sizeOf: 2,   
}

/**
 * BoundaryLoop, implemented using halfEdge
 */
class BoundaryArray extends PixelArrayGroup {
   constructor(bLoop, fmm) {
      super(fmm);
      this._vertex = bLoop?.vertex;
      this._wEdge = bLoop?.wEdge;
      this._prev = bLoop?.prev;
      this._next = bLoop?.next;
      this._hole = bLoop?.hole;
   }
   
   get _freeSlot() {
      return this._wEdge;
   }
   
   * _baseEntries() {
      yield ["_vertex", this._vertex];
      yield ["_wEdge", this._wEdge];
      yield ["_prev", this._prev];
      yield ["_next", this._next];
      yield ["_hole", this._hole];
   }
   
   static create(size) {
      const hArray = {
         vertex: Int32PixelArray.create(1, 1, size),           // point to vertex,
         wEdge: Int32PixelArray.create(1, 1, size),            // point back to wEdge if any
         prev: Int32PixelArray.create(1, 1, size),             // negative value to hEdge
         next: Int32PixelArray.create(1, 1, size),             // negative value
         hole: Int32PixelArray.create(1, 1, size),             // negative value to hole, >=0 isEmpty/free
      };
      
      return new BoundaryArray(hArray, {});
   }
   
   static rehydrate(self) {
      const ret = new BoundaryArray({}, {});
      ret._rehydrate(self);
      return ret;
   }
   
   // alloc/free memory
   allocArray(count) {
      const array = super.allocArray(count);
      
      // convert to offset index;
      for (let i = 0; i < array.length; ++i) {
         this._hole.set(array[i], 0, -1);
         array[i] = -(array[i]+1);
      }
      return array;
   }
   
   free(handle) {
      handle = -(handle+1);
      super.free(handle);
      this._hole.set(handle, 0, 0);
      //this._next.set(handle, 0, handle);        // point to self
   }
   
   length() {
      return this._hole.length();
   }
   
   // iterator routines
   /**
    * iterator for unassigned boundary edges.
    */
   * unassignedBoundary() {
      const length = this.length();
      for (let i = 0; i < length; ++i) {
         if (this._hole.get(i, 0) < 0) {   // 1 is for used by unassigned boundaryEdge
            yield -(i+1);
         }
      }
   }

   * boundaryLoop(current) {
      const start = current;
      do {
         yield current;
         current = this.next(current);
      } while (current !== start);
   }
   
   //
   // remove hole, make the buffer contiguous. 
   // boundaryLoop make it contiguous too.
   //
   compactBuffer(holeContainer, whEdgeContainer) {
      if (holeContainer.length() === 0) {
         return;
      }
      
      const size = this._vertex.length();
      // new buffer
      const bArray = {
         vertex: Int32PixelArray.create(1, 1, size),           // point to vertex.
         prev: Int32PixelArray.create(1, 1, size),             // negative value to hEdge
         next: Int32PixelArray.create(1, 1, size),             // negative value
         hole: Int32PixelArray.create(1, 1, size),             // negative value to hole, positive to nGon(QuadEdgeArray). 0 for empty
         wEdge: Int32PixelArray.create(1, 1, size),            // point back to wEdge if any
      };
      // do allocation
      const totalBytes = this.constructor.totalStructSize(bArray, size);
      const bArrayBuffer = allocBuffer(totalBytes);
      this.constructor.setBufferAll(bArray, bArrayBuffer, 0, size);
      for (let i in bArray) {
         bArray[i].appendRangeNew(size);
      }
      
      // redo boundaryLoop, one by one
      let i = 0;
      for (let hole of holeContainer) {
         let head = i;
         for (let dEdge of holeContainer.halfEdgeLoop(this, hole)) { // walk over boundaryLoop
            if (i === 49) {
               console.log("-50");
            }
            const hEdge = -(dEdge+1);
            bArray.hole.set(i, 0, hole);
            bArray.next.set(i, 0, -(i+2));
            bArray.prev.set(i, 0, -i);
            bArray.vertex.set(i, 0, this._vertex.get(hEdge, 0));
            const wEdge = this._wEdge.get(hEdge, 0);
            bArray.wEdge.set(i, 0, wEdge);
            // remember to update wEdge too
            const leftOrRight = wEdge % 2;
            whEdgeContainer.setHalf( wEdge >> 1, leftOrRight, -(i+1));
            i++;
         }
         // fix next, prev.
         bArray.next.set(i-1, 0, -(head+1));
         bArray.prev.set(head, 0, -i);             // -i = -(i-1+1)
         holeContainer.setHalfEdge(hole, -(head+1));
      }
      // dealloc extra.
      const extra = size - i;
      for (let i in bArray) {
         bArray[i].shrink(extra);
      }
 
      this._freeMM.size = this._freeMM.head = 0;
      // replace buffer
      this._vertex = bArray.vertex;
      this._prev = bArray.prev;
      this._next = bArray.next;
      this._hole = bArray.hole;
      this._wEdge = bArray.wEdge;
   }
   
   next(hEdge) {
      return this._next.get(-(hEdge+1), 0);
   }
   
   prev(hEdge) {
      return this._prev.get(-(hEdge+1), 0);
   }
   
   hole(hEdge) {
      return this._hole.get(-(hEdge+1), 0);
   }
   
   setHole(hfEdge, hole) {
      this._hole.set(-(hfEdge+1), 0, hole);
   }
   
   linkNext(hEdge, next) {
      if (hEdge < 0 && next < 0) {
         this._next.set(-(hEdge+1), 0, next);
         this._prev.set(-(next+1), 0, hEdge);
      } else {
         throw("bad connection");
      }
   }
   
   origin(hEdge) {
      return this._vertex.get(-(hEdge+1), 0);
   }
   
   setOrigin(hEdge, vertex) {
      this._vertex.set(-(hEdge+1), 0, vertex);
   }
   
   whEdge(hfEdge) {
      return this._wEdge.get(-(hfEdge+1), 0);
   }
   
   setWhEdge(hfEdge, whEdge) {
      this._wEdge.set(-(hfEdge+1), 0, whEdge);
   }
   
} 


class WholeEdgeArray extends PixelArrayGroup {
   constructor(wEdge, fmm) {
      super(fmm);
      this._edge = wEdge?.edge;
      this._sharpness = wEdge?.sharpness;
   }
   
   get _freeSlot() {
      return this._edge;
   }
   
   * _baseEntries() {
      yield ["_edge", this._edge];
      yield ["_sharpness", this._sharpness];
   }
   
   static create(size) {
      const wEdgeArray = {
         edge: Int32PixelArray.create(wEdgeK.sizeOf, 2, size), // [left, right]
         sharpness: Float32PixelArray.create(1, 1, size),      // crease weights is per wEdge, sharpness is float, (int is enough, but subdivision will create fraction, so needs float)
      };
      
      return new WholeEdgeArray(wEdgeArray, {});
   }
   
   static rehydrate(self) {
      const ret = new WholeEdgeArray({}, {});
      ret._rehydrate(self);
      return ret;
   }
   
   wEdgeBuffer() {
      return this._edge.getBuffer();
   }
   
   length() {
      return this._sharpness.length();
   }
   
   left(wEdge) {
      return this._edge.get(wEdge, wEdgeK.right);
   }

   pair(hEdge) {
      return this._edge._get( hEdge ^ 1 );   // left to right, right to left
   }
   
   right(wEdge) {
      return this._edge.get(wEdge, wEdgeK.left);
   }
   
   whole(wEdge, value=[0,0]) {
      this._edge.getVec2(wEdge, 0, value);
      return value;
   }

   setHalf(wEdge, leftOrRight, value) {
      this._edge.set(wEdge, leftOrRight, value);
   }
   
   setWhole(wEdge, left, right) {
      this._edge.setValue2(wEdge, 0, left, right);
   }
   
   setWhole2(wEdge, leftRight) {
      this._edge.setVec2(wEdge, 0, leftRight);
   }
   
   sharpness(wEdge) {
      return this._sharpness.get(wEdge, 0);
   }
   
   setSharpness(wEdge, sharpness) {
      this._sharpness.set(wEdge, 0, sharpness);
   }
}



/** 
 * triangle use 3 directEdge(HalfEdge) as an unit
 * 
 */
class TriangleEdgeArray extends ExtensiblePixelArrayGroup {
   constructor(dArray, bArray, wEdgeArray, props, fmm) {
      super(props, fmm);
      // tri directededge
      //this._dArray = dArray;
      this._vertex = dArray?.vertex;
      this._wEdge = dArray?.wEdge;
      // boundaryLoop edge/polygon edge
      this._bArray = new BoundaryArray(bArray, {});
      // wholeEdge specific value
      this._wEdgeArray = new WholeEdgeArray(wEdgeArray, {});
   }
   
   get _freeSlot() {
      return this._wEdge;
   }
   
   * _baseEntries() {
      yield ["_vertex", this._vertex];
      yield ["_wEdge", this._wEdge];
   }
   
   static create(size) {
      const dArray = { // odd number of index and odd number of polygon(triangle) created false sharing, so we have to separate everything out
         vertex: Int32PixelArray.create(1, 1, size),
         wEdge: Int32PixelArray.create(1, 1, size),            // point back to wEdge' left or right
      };
      const bArray = {
         vertex: Int32PixelArray.create(1, 1, size),           // point to vertex,
         wEdge: Int32PixelArray.create(1, 1, size),            // point back to wEdge if any
         prev: Int32PixelArray.create(1, 1, size),             // negative value to hEdge
         next: Int32PixelArray.create(1, 1, size),             // negative value
         hole: Int32PixelArray.create(1, 1, size),             // negative value to hole, 0 for empty
      };
      const wEdgeArray = {
         edge: Int32PixelArray.create(wEdgeK.sizeOf, 2, size), // [left, right]
         sharpness: Float32PixelArray.create(1, 1, size),      // crease weights is per wEdge, sharpness is float, (int is enough, but subdivision will create fraction, so needs float)
      };
      return new TriangleEdgeArray(dArray, bArray, wEdgeArray, {});
   }
   
   _rehydrate(self) {
      super._rehydrate(self);
      
      this._bArray = BoundaryArray.rehydrate(self._bArray);
      this._wEdgeArray = WholeEdgeArray.rehydrate(self._wEdgeArray);
   }
   
   static rehydrate(self) {
      const ret = new TriangleEdgeArray({},{},{},{},{});
      ret._rehydrate(self);
      return ret;
   }
   
   getDehydrate(obj) {
      super.getDehydrate(obj);

      obj._bArray = this._bArray.getDehydrate({});

      obj._wEdgeArray = this._wEdgeArray.getDehydrate({});
      
      return obj;
   }
   
   get b() {
      return this._bArray;
   }
   
   get w() {
      return this._wEdgeArray;
   }
   
   computeBufferSizeAll(length, bLength, wLength) {
      return this.computeBufferSize(length)
            + this._bArray.computeBufferSize(bLength)
            + this._wEdgeArray.computeBufferSize(wLength);
   }
   
   setBufferAll(bufferInfo, byteOffset, length, bLength, wLength) {
      if (!bufferInfo) {
         bufferInfo = allocBuffer(this.computeBufferSizeAll(length, bLength, wLength));
         byteOffset = 0;
      }
      
      byteOffset = this.setBuffer(bufferInfo, byteOffset, length);
      byteOffset = this._bArray.setBuffer(bufferInfo, byteOffset, bLength);
      
      return this._wEdgeArray.setBuffer(bufferInfo, byteOffset, wLength);
   }

   createVertexTexture(gl) {
       return this._vertex.createDataTexture(gl);
   }
   
   vBuffer() {
      return this._vertex.getBuffer();
   }
   
   wBuffer() {
      return this._wEdge.getBuffer();
   }
   
   wEdgeBuffer() {
      return this._wEdgeArray.wEdgeBuffer();
   }
   
   // allocation/free routines.
   /**
    * 
    */
   allocWhEdge(dEdge, pair) {
      const handle = this._wEdgeArray.alloc();
      this.setWhEdge(handle, dEdge, pair);
      return handle;
   }
   
   allocBoundaryEdge(handle) {
      const length = handle.length;
      const free = this._bArray.allocArray(length);
      // now connect the boundary loop together. cw loop.
      let j = free.length - 1;
      for (let i = 0; i < free.length; i++) {
         this._bArray.linkNext(free[i], free[j]);
         //this._bArray.setHole(free[i], 1);
         j = i;
      }
      
      return free;
   }
   
   freeBoundaryEdge(hEdge) {
      this._bArray.free(hEdge);
   }
   
   _allocDirectedEdge(hEdge, length) {
/*      if (this._vertex.capacity() < length) {
         let maxLen = this._vertex.maxLength();
         maxLen = expandAllocLen(maxLen+length);
         this.setBuffer(null, 0, maxLen, computeDataTextureLen(Math.floor(maxLen/3*2)) );   // TODO: What the optimal wEdge expansion size? 
      } */
            
      const handle = [];
      if (hEdge >= this._vertex.length()) { // asking for new one, hEdge === length().
         this.allocArray(length);
      }
      for (let i = hEdge; i < (hEdge+length); ++i) {
         handle.push( i );
      }
      return handle;
   }
   
   //
   // iterator routines
   //
   
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this._wEdgeArray.length());
   }
   
   /**
    * walk over the wEdgeArray
    */
   * rangeIter(start, stop) {
      stop = Math.min(this._wEdgeArray.length(), stop);
      let leftRight = [0, 0];
      for (let i = start; i < stop; i++) {
         const sharpness = this._wEdgeArray.sharpness(i);
         if (sharpness >= 0) {  // existed.
            this._wEdgeArray.whole(i, leftRight);
            yield [i, leftRight[0], leftRight[1]];
         }
      }
   }

   /**
    * direct access to the main directedEdge
    */
/*   * halfEdgeIter() {
      for (let i = 0; i < this._vertex.length(); ++i) {
         if (this._vertex.get(i, 0) >= 0) {
            if (!this.isFree(i)) {
               yield i;
            }
         }
      }
   } */

   /**
    * work through all the halfEdge, boundary, nGon, freed face.
    */
/*   * _boundaryEdgeIter() {
      for (let i = 0; i < this._hArray.hole.length(); ++i) {
         yield -(i+1);
      }
   } */

   /**
    * iterate over face's inner edge staring from input hEdge
    */
   * faceIter(hEdge) {
      yield (hEdge);
      yield (hEdge+1) % 3;
      yield (hEdge+2) % 3;
   }
   
   //
   // main api
   //
   
   length() {
      return this._wEdge.length();      // NOTE: what about freed? will tried to compact() after every operation. 
   }

   static kNextEdge = [1, 1, -2];
   static kPrevEdge = [-2, 1, 1];

   next(dEdge) {
      if (dEdge >= 0) {
         const i = dEdge % 3;       // remainder
         return dEdge + TriangleEdgeArray.kNextEdge[i];
      } else {
         return this._bArray.next(dEdge);
      }
   }
   
   prev(dEdge) {
      if (dEdge >= 0) {
         const i = dEdge % 3;
         return dEdge - TriangleEdgeArray.kPrevEdge[i];
      } else {
         return this._bArray.prev(dEdge);
      }
   }
   
   /**
    * get face or hole.
    */
   face(dEdge) {
      if (dEdge >= 0) {
         return Math.trunc(dEdge/3);
      } else {
         return this._bArray.hole(dEdge);
      }
   }

   isBoundary(dEdge) {  // not true for Quad, needs to override
      return (dEdge < 0);
   }
   
   destination(hEdge) {
      return this.origin( this.next(hEdge) );   // next is better than pair because no pair lookup only computation in most cases.
   }
   
   /**
    * return incident vertex position.
    */
   origin(hEdge) {
      if (hEdge >= 0) {
         return this._vertex.get(hEdge, 0);
      } else {
         return this._bArray.origin(hEdge);
      }
   }
   
   setOrigin(hEdge, vertex) {
      if (hEdge >= 0) {
         this._vertex.set(hEdge, 0, vertex);         
      } else {
         this._bArray.setOrigin(hEdge, vertex);
      }
   }

   pair(hEdge) {
      if (hEdge >= 0) {
         return this._wEdgeArray.pair( this._wEdge.get(hEdge, 0) );        // left to right, right to left
      } else {
         return this._wEdgeArray.pair( this._bArray.whEdge(hEdge) );       // left to right, right to left
      }
   }
      
   _whEdge(hEdge) {
      if (hEdge >= 0) {
         return this._wEdge.get(hEdge, 0);
      } else {
         return this._bArray.whEdge(hEdge);
      }
   }
   
   wEdge(hEdge) {
      return this._whEdge(hEdge) >> 1;
   }
   
   isWEdgeLeft(hEdge) {
      return (this._whEdge(hEdge) & 1) === 0;
   }
   
   isWEdgeRight(hEdge) {
      return this._whEdge(hEdge) & 1;
   }
   
   _setHEdgeWEdge(hEdge, wEdgePosition, pair) {
      if (hEdge < 0) {
         this._bArray.setWhEdge(hEdge, wEdgePosition);
      } else {
         this._wEdge.set(hEdge, 0, wEdgePosition);
      }
   }
   
   _computeLeftRight(hEdge, pair) {
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
      return [hEdge, pair];
   }
   
   setWhEdge(wEdge, left, right) {
      const leftRight = this._computeLeftRight(left, right);
      // reset all
      this._setHEdgeWEdge(leftRight[0], wEdge * 2 + wEdgeK.left, leftRight[1]);
      this._setHEdgeWEdge(leftRight[1], wEdge * 2 + wEdgeK.right, leftRight[0]);
      this._wEdgeArray.setWhole2(wEdge, leftRight);
   }
   
   /**
    * get sharpness from wEdge sharpness.
    * @param {int} dEdge 
    */
   sharpness(dEdge) {
      const wEdge = this.wEdge(dEdge);
      return this._wEdgeArray.sharpness(wEdge);
   }

   setSharpness(dEdge, sharpness) {
      const wEdge = this.wEdge(dEdge);
      this._wEdgeArray.setSharpness(wEdge, sharpness);
   }
   
   stat() {
      return "WholeEdge Count: " + this.w.length() + ";\nDirectedEdge Count: " + this.length() + ";\n";
   }

   sanityCheck() {
      const wEdgeArray = this.w;
      let length = wEdgeArray.length();
      for (let i = 0; i < length; ++i) {
         const [left,right] = wEdgeArray.whole(i);
         if (right >= 0 && left > right) {
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
/*      // check hArray.freed
      let freeCount = 0;
      let current = this._fmm.hArray.head;
      while (current < 0) {
         current = this._hArray.next.get(-(current+1), 0);
         freeCount++;
      }
      if (freeCount !== this._fmm.hArray.size) {
         console.log("FreeCount disagree, expected: " + this._fmm.hArray.size + " got: " + freeCount);
         return false;
      } */
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






class TriangleArray extends ExtensiblePixelArrayGroup {
   constructor(materialDepot, array, prop, fmm) {
      super(prop, fmm);
      this._material = array?.material;
      this._depot = materialDepot;
   }
   
   get _freeSlot() {
      return this._material;
   }
   
   * _baseEntries() {
      yield ["_material", this._material];
   }

   static rehydrate(self) {
      const ret = new TriangleArray(null, {}, {}, {});
      ret._rehydrate(self);
      return ret;
   }

   static create(depot, size) {
      const array = {
         material: Int32PixelArray.create(1, 1, size),
      };
      const fmm = {};
      
      return new TriangleArray(depot, array, {}, fmm);
   }
      
   alloc(material) {
      const face = this.allocArray(1)[0];
      this._setMaterial(face, material);
      return face;
   }
   
   free(handle) {
      throw("not implemented");
      this._depot.releaseRef(this.material(handle));
      // this._faces.free(handle);
   }
   
   freeFace(fHandle) {
      
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
   
   * vertexLoop(hEdgeContainer, face) {
      for (const hEdge of this.halfEdgeLoop(hEdgeContainer, face)) {
         yield hEdgeContainer.origin(hEdge);
      }
   }
   
   /* * wEdgeLoop(face) {
   }*/
   
   * faceAround(hEdgeContainer, face) {
      for (let [hEdge, neighborFace] of this.faceAroundEntries(hEdgeContainer, face)) {
         yield neighborFace;
      }
   }
   
   * faceAroundEntries(hEdgeContainer, face) {
      for (const hEdge of this.halfEdgeLoop(face)) {
         const pair = hEdgeContainer.pair(hEdge);
         if (pair >= 0) { // we want face not hole
            yield [hEdge, hEdgeContainer.face(pair)];
         }
      }
   }
   
   // Iterator for the HalfEdge connecting to the triangle.
   * halfEdgeLoop(_h, face) {
      face *= 3;
      yield face;
      yield (face+1);
      yield (face+2);
   }
   
   /**
    * similar to array.entries
    * @param {handle} face 
    */
   * halfEdgeLoopEntries(_h, face) {
      face *= 3;
      yield [0, face];
      yield [1, face+1];
      yield [2, face+2];
   }
   
   halfEdgeLoopArray(_h, tri) {   // static possible,
      tri *= 3;
      return [tri, tri+1, tri+2];
   }
   
   halfEdgeCount(_hEdges, _tri) {   // triangle is 3 side
      return 3;
   }
   
   halfEdge(tri) {
      return tri*3;
   }   
   
   length() {
      return (this._material.length());
   }
   
   setHalfEdge(handle, hEdge) {  // implicit halfEdge, no needs to set
      throw("cannot set Face's halfEdge");
   }
   
   createMaterialTexture(gl) {
      return this._material.createDataTexture(gl);
   }
      
   _materialAddRef(material, count) {
      this._depot.addRef(material, count);
   }
   
   material(polygon) {
      return this._material.get(polygon, 0);
   }
   
   _setMaterial(polygon, material) {
      this._material.set(polygon, 0, material);
   }

   setMaterial(polygon, material) {
      let oldMaterial = this.material(polygon);
      if (oldMaterial !== material) {
         this._setMaterial(polygon, material);
         this._depot.addRef(material, 1);
         this._depot.releaseRef(oldMaterial, 1);
      }
   }

   sanityCheck(hEdgeContainer) {   // halfEdge and Triangle are align automatically, always true.
      for (let face of this) {
         for (let hEdge of this.halfEdgeLoop(hEdgeContainer, face)) {
            const pair = hEdgeContainer.pair(hEdge);
            //if (hEdgeContainer.isBoundary(pair)) {
            //   console.log("polygon: " + face + " has boundary: " + pair + " on hEdge: " + hEdge);
            //}
         }
      }
      return true;
   }
   
   stat() {
      return "Triangle Count: " + this.length() + ";\n";
   }  
}


/**
 * BoundaryLoop aka HoleArray
 */
class HoleArray extends PixelArrayGroup {
   constructor(holes) {
      super({});
      this._hole = holes?.hole;
      this._numberOfSide = holes?.numberOfSide;
   }
   
   get _freeSlot() {
      return this._hole;
   }
   
   * _baseEntries() {
      yield ["_hole", this._hole];
      yield ["_numberOfSide", this._numberOfSide];
   }

   static create(buffer, byteOffset, length) {
      const base = {
         hole: Int32PixelArray.create(1, 1),
         numberOfSide: Int32PixelArray.create(1, 1),
      }
      base.hole.appendNew();           // zeroth hole is reserved for sentinel purpose.
      return new HoleArray(base);
   }

   static rehydrate(self) {
      const holes = new HoleArray({});
      holes._rehydrate(self);
      return holes;
   }
   
   computeBufferSize(length) {
      if (length) {
         return super.computeBufferSize(length+1);
      }
      return 0;
   }
   
   setBuffer(bufferInfo, byteOffset, length) {
      if (length) {
         length++;                                             // sentinel
      }
      
      return super.setBuffer(bufferInfo, byteOffset, length);
   }

   /**
    * assumed this is pristine, reconstruct hole from another one, used by subdivide.
    * @param {HoleArray} src
    */
   _copy(src) {
      const srcLen = src._holes.length();
      this._hole.appendRangeNew(srcLen - this._hole.length());
      this._numberOfSide.appendRangeNew(srcLen - this._numberOfSide.length());
      // now copy everything.
      for (let i = 0; i < srcLen; ++i) {
         this._hole.set(i, 0, src._hole.get(i, 0));
         this._numberOfSide.set(i, 0, src._numberOfSide.get(i, 0));
      }
   }
   
   *[Symbol.iterator] () {
      const len = this._hole.length();
      for (let i = 1; i < len; ++i) {  // skipped 0, it sentinel
         if (!this._isFree(i)) {
            yield i;
         }
      }
   }

   * halfEdgeLoop(hEdgeContainer, hole) {
      const start = this.halfEdge(hole);
      let current = start;
      do {
         yield current;
         current = hEdgeContainer.next(current);
      } while (current !== start);
   }
   
   free(handle) {
      // assume handle is valid
      if (handle > 0) {
         super.free(handle);
         this._numberOfSide(handle, 0, 0);                // reset to free
      }
   }
   
   /**
    * number of side === 0 must be free. actually anthing <= 2 must be invalid hole.
    * @param {Int} hole handle
    * @returns {bool}
    */
   _isFree(hole) {
      const sides = this._numberOfSide.get(hole, 0);
      return (sides === 0);
   }
         
   length() {
      return this._hole.length()-1;
   }

   halfEdge(handle) {
      if (handle > 0) {
         return this._hole.get(handle, 0);
      } else {
         throw("invalid hole: " + handle);
      }
   }

   setHalfEdge(handle, hEdge) {
      if (handle > 0) {
         this._hole.set(handle, 0, hEdge);
      } else {
         throw("invalid hole: " + handle);
      }
   }
   
   setNumberOfSide(handle, sides) {
      if (handle > 0) {
         this._numberOfSide.set(handle, 0, sides);
      } else {
         throw("invalid hole: " + handle);
      }
   }

   sanityCheck(hEdgeContainer) {
      let sanity = true;
      for (let hole of this) {
         for (let hEdge of this.halfEdgeLoop(hEdgeContainer, hole)) {
            const holeCheck = hEdgeContainer.b.hole(hEdge);
            if (holeCheck !== hole) {
               sanity = false;
               break;
            }
         }
      }
      return sanity;
   }

   stat() {
      return "Holes Count: " + (this._hole.length()-1-this._freeMM.size) + ";\n";
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



function isSame(as, bs) {
   return as.size === bs.size && [...as].every(value => bs.has(value));
}

/** 
 * abstract class representing Mesh. base SurfaceMesh, managing material,
 * vertex, hEdge, face, and boundaryLoop.
 */
class TriangleMesh {
   constructor(hEdges, vertices, faces, holes, bin, material) {
      this._bin = bin;
      this._material = material;
      this._hEdges = hEdges;
      this._vertices = vertices;
      this._faces = faces;
      this._holes = holes;
   }

   static create(materialDepot, size) {
      const params = this._createInternal(materialDepot);

      const dEdges = TriangleEdgeArray.create(size);
      const vertices = VertexArray.create(size);
      const faces = TriangleArray.create(params[1].proxy, size);
      const holes = HoleArray.create(size);

      return new TriangleMesh(dEdges, vertices, faces, holes, ...params);
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
   
   static rehydrate(self) {
      if (self._hEdges && self._vertices && self._faces && self._holes) {
         const params = [null, null];
         const dEdges = TriangleEdgeArray.rehydrate(self._hEdges);
         const vertices = VertexArray.rehydrate(self._vertices, dEdges);
         const faces = TriangleArray.rehydrate(self._faces, dEdges);
         const holes = HoleArray.rehydrate(self._holes, dEdges);

         return new TriangleMesh(dEdges, vertices, faces, holes, ...params);
      }
      throw("TriangleMesh rehydrate(): bad input");
   }

   getDehydrate(obj) {
      obj._hEdges = this._hEdges.getDehydrate({});
      obj._vertices = this._vertices.getDehydrate({});
      obj._faces = this._faces.getDehydrate({});
      obj._holes = this._holes.getDehydrate({});

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
    * simple wrapper around FaceArray.halfEdgeLoop 
    */ 
   halfEdgeAroundFace(face) {
      return this._faces.halfEdgeLoop(this._hEdges, face);
   }
   
   //halfEdgeEntriesAroundFace(face) {
   //   return this._faces.halfEdgeEntriesLoop(this._hEdges, faces);
   //}
   
   faceAroundFace(face) {
      return this._faces.faceAround(this._hEdges, face);
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
      changed.h = this.h.b.compactBuffer(this.o, this.h.w);
      
      return changed;
   }

   // post process
   // fill boundaryLoop with holes.
   fillBoundary() {
      // walk through all unassigned boundaryEdge, assign hole to each boundary group.
      const boundaryArray = this._hEdges.b; 
      for (let boundary of boundaryArray.unassignedBoundary()) {
         //let hole = boundaryArray.hole(boundary);
         //if (hole === 0) {      // hEdge unassigned, get a new Hole and start assigning the whole group.
            let hole = this._holes.alloc();
            this._holes.setHalfEdge(hole, boundary);
            let sides = 0;
            // assigned holeFace to whole group
            for (let current of boundaryArray.boundaryLoop(boundary)) {
               this._hEdges.setSharpness(current, -1);   // boundary is infinite crease.
               boundaryArray.setHole(current, hole);
               sides++;
            }
            this._holes.setNumberOfSide(hole, sides);
         //}
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
   
   
   _computeNormal() {
      this.v.computeLoopNormal(this.h);
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
      //v.setValence(vertex, -1);              // valence(-1) for unitialized yet.
      v.copyPt(vertex, inPt, inOffset);
      return vertex;
   }
   
   
   /**
    * return a bunch of triangle if it a polygon. assumed polygon is well behaved.
    * break up polygon as triangle fan like.
    */
   _addPolygon(pts, material) {
      const tri = [];
      const triPts = [pts[0], 0, 0];
      const length = pts.length;
      for (let i = 2; i < length; ++i) {
         triPts[1] = pts[i-1];
         triPts[2] = pts[i];
         tri.push( this.addFaceEx(0, 3, triPts, material) );
      }
      
      return tri;
   }
   
   /**
    * triangle only.
    */
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
      //this._hEdges.setWhole(c, d);
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
      const polyLoop = this._faces.halfEdgeLoopArray(this.h, newPoly);
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
               this._hEdges.b.linkNext(a, b);
               this._hEdges.b.linkNext(d, c);
            } 
            
            // check tail for pairing and collapse
            c = this._hEdges.prev(a);
            if (c !== b) { // not already collapsed
               d = this._hEdges.next(b);
               this._hEdges.b.linkNext(b, a);
               this._hEdges.b.linkNext(c, d);
            }
            
            // now safely remove the freed-pair, and connect the 2 tri
            c = this._collapseEdge(a, b);
            let wEdge = this._hEdges.wEdge(c);           // use pair's allocated wEdge.
            this._hEdges.setWhEdge(wEdge, polyLoop[i], c);
         } else {// remember to allocated a new wEdge.
            const pair = boundaryLoop[i];                //this._hEdges.pair( polyLoop[i] );
            this._hEdges.allocWhEdge(polyLoop[i], pair);
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
                
            this._hEdges.b.linkNext(b, a);
            this._hEdges.b.linkNext(c, d);
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
         hEdges.b.linkNext(inEdge, outEdge);
         hEdges.b.linkNext(d, b);
      } else {
         const h = hEdges.next(g);

         hEdges.b.linkNext(inEdge, outEdge);

         hEdges.b.linkNext(g, b);

         hEdges.b.linkNext(d, h);
      }
      return true;
   }  
   
   _allocPolygon(material, side) {
      if (side !== 3) { //must be a triangle
         console.log("Bad Triangle: not 3 edges");
         throw("Triangle Only: " + side + " edges.");
      }
      const handle = this._faces.alloc(material);
      this._hEdges._allocDirectedEdge(handle * 3, 3);     // alloc 3 directed edges.
      return handle;
   }  
   
   _freePolygon(faceHndl) {
      //this._;
      
   }
    
   sanityCheck() { 
      const hOk = this.h.sanityCheck();
      const vOk = this.v.sanityCheck(this.h);
      const fOk = this.f.sanityCheck(this.h);
      const oOk = this.o.sanityCheck(this.h);
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

   // for debugging purpose.
/*   _gatherEdge(vertex) {
      let outPut = [];
      let fEdges = new Set;
      let dEdges = new Set;
      for (let outEdge of this._vertices.outHalfEdgeAround(this._hEdges, vertex)) {
         let inEdge = this._hEdges.pair(outEdge);
         outPut.push( {out: outEdge, in: inEdge} );
         if (this._hEdges.isBoundary(outEdge)){
            fEdges.add(outEdge);
         } else {
            dEdges.add(outEdge);
         }
         if (this._hEdges.isBoundary(inEdge)) {
            fEdges.add(inEdge);
         } else {
            dEdges.add(inEdge);
         }
      }
      return [dEdges, fEdges, outPut];
   }*/
}





export {
//   VertexArray,
   TriangleEdgeArray,
//   TriangleArray,
//   HoleArray,
   TriangleMesh,
}
