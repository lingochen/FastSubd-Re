/**
 * DirectedEdge instead of traditional HalfEdge. 
 * Same operation as HalfEdge, implicit next/prev and explicit pair data member.
 * Traditional HalfEdge is explicit next/prev but implicit pair data member.
 * AddFace() different logic from HalfEdge.
 * better cache coherence and more similar to traditional face/vertex representation.
 * easier to optimize for parallel subdivision.
 * Use WholeEdge/HalfEdge as container instead of TriangleEdgeArray. The reverse of original design. (2025/03)  
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
 * 
 * BoundaryArray
 * TriangleEdgeArray
 * HalfEdgeArray
 * WholeEdgeArray
 */
import {Int32PixelArray, Float32PixelArray, Uint8PixelArray, Float16PixelArray, allocBuffer, PixelArrayGroup, ExtensiblePixelArrayGroup} from './pixelarray.js';

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
      this._hfEdge = bLoop?.hfEdge;
      this._prev = bLoop?.prev;
      this._next = bLoop?.next;
   }
   
   get _freeSlot() {
      return this._hfEdge;
   }
   
   * _baseEntries() {
      yield ["_hfEdge", this._hfEdge];
      yield ["_prev", this._prev];
      yield ["_next", this._next];
   }
   
   static create(size) {
      const hArray = {
         hfEdge: Int32PixelArray.create(1, 1, size),           // point back to wEdge if any
         prev: Int32PixelArray.create(1, 1, size),             // negative value to hEdge
         next: Int32PixelArray.create(1, 1, size),             // negative value
      };
      
      return new BoundaryArray(hArray, {});
   }
   
   static rehydrate(self) {
      const ret = new BoundaryArray({}, {});
      ret._rehydrate(self);
      return ret;
   }
   
   // alloc/free memory
/*   allocArray(count) {
      const array = super.allocArray(count);
      
      // convert to offset index;
      for (let i = 0; i < array.length; ++i) {
         array[i] = -(array[i]+1);
      }
      return array;
   } */
   
   free(handle) {
      super.free(handle);
      this._next.set(handle, 0, handle);     // point to self
   }
   
   // iterator routines
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this.length());
   }

   /**
    * walk through all the boundary.
    */
   * rangeIter(start, stop) {
      stop = Math.min(this.length(), stop);
      for (let i = start; i < stop; i++) {
         let next = this._next.get(i, 0);
         if (i !== next) {
            yield i;
         }
      }            
   }

   /**
    * loop through hole,
    */
   * halfEdgeAround(current) {
      const start = current;
      do {
         yield current;
         current = this.next(current);
      } while (current !== start);
   }
   
   /**
    * remove hole, make the buffer contiguous. 
    * boundaryLoop make it contiguous too.
    */
   compactBuffer(holeContainer, whEdgeContainer) {
      if (holeContainer.length() === 0) {
         return;
      }
      
      const size = this._hfEdge.length();
      // new buffer
      const bArray = {
         prev: Int32PixelArray.create(1, 1, size),             // negative value to hEdge
         next: Int32PixelArray.create(1, 1, size),             // negative value
         hfEdge: Int32PixelArray.create(1, 1, size),           // point back to wEdge if any
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
         let bHalf = holeContainer.halfEdge(hole);
         bHalf = -(whEdgeContainer.half(bHalf)+1);       // convert to local index
         const length = holeContainer.numberOfSide(hole);
         const start = i;
         let j = 0;
         let prev = length-1;
         for (let hEdge of this.halfEdgeAround(bHalf) ) { // walk over boundaryLoop
            const hfEdge = this._hfEdge.get(hEdge, 0);
            bArray.hfEdge.set(i, 0, hfEdge);
            bArray.next.set(i, 0, start + ((j+1) % length));
            bArray.prev.set(i, 0, start + prev);
            // remember to update whEdge too
            whEdgeContainer.setHalf(hfEdge, -(i+1));  // negative index to differentiated from dEdge
            prev = j;
            i++;
            j++;
         }
      }
      // dealloc extra.
      const extra = size - i;
      for (let i in bArray) {
         bArray[i].shrink(extra);
      }
 
      this._freeMM.size = this._freeMM.head = 0;
      // replace buffer
      this._prev = bArray.prev;
      this._next = bArray.next;
      this._hfEdge = bArray.hfEdge;
   }
   
   next(hEdge) {
      return this._next.get(hEdge, 0);
   }
   
   prev(hEdge) {
      return this._prev.get(hEdge, 0);
   }
   
   linkNext(hEdge, next) {
      this._next.set(hEdge, 0, next);
      this._prev.set(next, 0, hEdge);
   }
   
   halfEdge(hfEdge) {
      return this._hfEdge.get(hfEdge, 0);
   }
   
   setHalfEdge(boundary, hfEdge) {
      this._hfEdge.set(boundary, 0, hfEdge);
   }
   
   /**
    * check the boundaryLoop's integrity. 
    * checking if prev and next value matches.
    */
   sanityCheck() {
      for (let i of this) {
         let next = this._next.get(i, 0);
         let prev = this._prev.get(next, 0);
         if (prev !== i) {
            console.log("inconsistent next-prev");
         }
         prev = this._prev.get(i, 0);
         next = this._next.get(prev, 0);
         if (next !== i) {
            console.log("inconsistent prev-next");
         }
      }
   }
} 


/** 
 * triangle use 3 directEdge(HalfEdge) as an unit
 * 
 */
class TriangleEdgeArray extends ExtensiblePixelArrayGroup {
   constructor(dArray, props, fmm) {
      super(props, fmm);
      this._vertex = dArray?.vertex;   // index to 3D point
      this._hfEdge = dArray?.hfEdge;   // point back to halfEdge
   }
   
   get _freeSlot() {
      return this._hfEdge;
   }
   
   * _baseEntries() {
      yield ["_vertex", this._vertex];
      yield ["_hfEdge", this._hfEdge];
   }
   
   static create(size) {
      const dArray = { // odd number of index and odd number of polygon(triangle) created false sharing, so we have to separate everything out
         vertex: Int32PixelArray.create(3, 1, size),           // point to 3D point
         hfEdge: Int32PixelArray.create(3, 1, size),           // point back to wEdge' left or right
         // real face pointer
      };
      return new TriangleEdgeArray(dArray, {});
   }
   
   static rehydrate(self) {
      const ret = new TriangleEdgeArray({},{});
      ret._rehydrate(self);
      return ret;
   }

   createVertexTexture(gl) {
      return this._vertex.createDataTexture(gl);
   }
   
   vBuffer() {
      return this._vertex.getBuffer();
   }
   
   wBuffer() {
      return this._hfEdge.getBuffer();
   }
   
   //
   // iterator routines
   //
   
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this._hfEdge.length());
   }
   
   /**
    * walk over triangle, not triangle edge.
    */
   * rangeIter(start, stop) {
      stop = Math.min(this._hfEdge.length(), stop);
      for (let i = start; i < stop; i++) {
         const face = this._face.get(i);
         if (face >= 0) {  // existed.
            yield i;
         }
      }
   }

   //
   // main api
   //
   
   origin(dEdge) {
      return this._vertex._get(dEdge);
   }
   
   setOrigin(dEdge, origin) {
      this._vertex._set(dEdge, origin);
   }
   
   setTriangle(tri, triPts) {
      this._vertex.setVec3(tri, 0, triPts);
   }

   static kNextEdge = [1, 1, -2];
   static kPrevEdge = [-2, 1, 1];

   /**
    * static ?
    */
   next(dEdge) {
      const i = dEdge % 3;       // remainder
      return dEdge + TriangleEdgeArray.kNextEdge[i];
   }
   
   prev(dEdge) {
      const i = dEdge % 3;
      return dEdge - TriangleEdgeArray.kPrevEdge[i];
   }
   
   halfEdge(dEdge) {
      return this._hfEdge._get(dEdge, 0);
   }

   setHalfEdge(dEdge, hfEdge) {
      this._hfEdge._set(dEdge, hfEdge);
   }
   
   whEdge(dEdge) {
      return this._hfEdge._get(dEdge,0) >> 1;
   }
   
   isWhEdgeLeft(dEdge) {
      return (this.halfEdgeEdge(dEdge) & 1) === 0;
   }
   
   isWhEdgeRight(dEdge) {
      return this.halfEdgeEdge(dEdge) & 1;
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


class HalfEdgeArray extends PixelArrayGroup {
   constructor(wEdge, fmm) {
      super(fmm);
      this._edge = wEdge?.edge;                 // [left, right] array
      this._face = wEdge?.face;                 // [face/hole, face/hole] pointer.
      // class Object array
      this._dEdge = wEdge?.dEdge;               // TriangleEdgeArray
      this._boundary = wEdge?.boundary;
   }
   
   get d() {
      return this._dEdge;
   }
   
   get b() {
      return this._boundary;
   }
   
   get _freeSlot() {
      return this._edge;
   }
   
   * _baseEntries() {
      yield ["_edge", this._edge];
      yield ['_face', this._face];
   }
   
   static create(size) {
      const hfEdgeArray = {
         edge: Int32PixelArray.create(1, 1, size),    // [left, right]
         face: Int32PixelArray.create(1, 1, size),    // point back to face/hole
         dEdge: TriangleEdgeArray.create(size),
         boundary: BoundaryArray.create(size),
      };
      
      return new HalfEdgeArray(hfEdgeArray, {});
   }
   
   _rehydrate(self) {
      super._rehydrate(self);
      
      this._boundary = BoundaryArray.rehydrate(self._boundary);
      this._dEdge = TriangleEdgeArray.rehydrate(self._dEdge);
   }
   
   static rehydrate(self) {
      const ret = new HalfEdgeArray({}, {});
      ret._rehydrate(self);
      return ret;
   }

   whEdgeBuffer() {
      return this._edge.getBuffer();
   }
   
   createVertexTexture(gl) {
       return this._dEdge.createVertexTexture(gl);
   }
   
   vBuffer() {
      return this._dEdge.vBuffer();
   }

   /**
    * alloc single triangle with boundary edge
    * 
    * @returns {array, array} - array of 3 int, for triangle, and boundary
    */
   allocTriangle(triPts) {
      const tri = this._dEdge.alloc();
      this._dEdge.setTriangle(tri, triPts);
      const dEdge = tri * 3;
      const dEdges = [dEdge, dEdge+1, dEdge+2];
      const bEdges = this._boundary.allocArray(3);
      // now connect the boundary loop together. ccw loop.
      for (let i=0, j=2; i < 3; j=i, i++) {
         this._boundary.linkNext(bEdges[i], bEdges[j]);
         //this._boundary.setHole(bEdges[i], 1)
      }
      
      return [dEdges, bEdges];
   }
   
   //
   // iterator routines
   // 

   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this.length());
   }
   
   /**
    * walk over the wholeEdgeArray
    */
   * rangeIter(start, stop) {
      stop = Math.min(this.length(), stop);
      let leftRight = [0, 0];
      for (let i = start; i < stop; i+=2) {
         if (this._face.get(i, 0) !== this._face.get(i+1, 0)) {
            yield [i, this._edge.get(i, 0)];
            yield [i+1, this._edge.get(i+1, 0)];
         }
      }
   }

   /**
    * iterator for unassigned boundary edges. edge is boundary number, negative values???
    */
   * unassignedBoundary() {
      for (let [i, left, right] of this) {
         if (left < 0) {   // boundary
            if (this._face.get(i, 0) >= 0) {   // boundary's unassigned face
               yield i*2;
            }
         }
         if (right < 0) {
            if (this._face.get(i, 1) >= 0) {
               yield i*2+1;
            }
         }
      }
   }
   
   /**
    * iterate over faces's inner halfEdge starting from input hEdge to end hEdge
    * @param {number} current - start of face hfEdge loop.
    * @param {number) end - end of face hfEdge loop.
    */
   * aroundF(current, end) {
      //if (start !== HalfEdgeK.end) {
         do {
            yield current;
            current = this.next(current);
         } while (current !== end);
      //}
   }
      
   * inAroundV(currentIn, end) {
      //if (currentIn !== HalfEdgeK.end) {
         do {
            yield currentIn;
            currentIn = this.pair( this.next( currentIn ) );
         } while (currentIn !== end);
      //}
   }

   * outAroundV(currentOut, end) {
      //if (currentOut !== HalfEdgeK.end) {
         do {
            yield currentOut;
            currentOut = this.next( this.pair(currentOut) );         
         } while (currentOut !== end);
      //}
   }
   
   // 
   // end of iterator
   //
   
   
   _getArray(hEdge) {
      hEdge = this._edge._get(hEdge);
      if (hEdge >= 0) {
         return [hEdge, this._dEdge];
      } else {
         return [-(hEdge+1), this._boundary];
      }
   }
   
   destination(hEdge) {
      if (hEdge & 1) {
         hEdge = this._edge._get(hEdge ^ 1);
         return this._dEdge.origin(hEdge);
      } else {
         hEdge = this._edge._get(hEdge);
         hEdge = this._dEdge.next(hEdge);
         return this._dEdge.origin(hEdge);
      }
   }
   
   // return incident vertex position
   origin(hEdge) {
      if (hEdge & 1) {
         hEdge = this._edge._get(hEdge ^ 1);
         hEdge = this._dEdge.next(hEdge);
         return this._dEdge.origin(hEdge);
      } else {
         hEdge = this._edge._get(hEdge);
         return this._dEdge.origin(hEdge);
      }
   }
   
//   setOrigin(hEdge, origin) {
//      this._vertex._set(hEdge, origin);
//   }
   
   /**
    * check if given hEdge is boundary.
    */
   isBoundary(hEdge) {
      return this._edge._get(hEdge) < 0;
   }

   _linkNext(a, b) {
      a = -(this._edge._get(a) + 1);   // back to positive index
      b = -(this._edge._get(b) + 1);
      this._boundary.linkNext(a, b);
   }
   
   
   /**
    * next polygon edge. skip over the internal edge if any
    * 
    */
   next(hEdge) {
      let privyHfEdge = this._edge._get( hEdge );
      
      if (privyHfEdge >= 0) {
         privyHfEdge = this._dEdge.next(privyHfEdge);
         return this._dEdge.halfEdge(privyHfEdge);
      } else {
         privyHfEdge = this._boundary.next( -(privyHfEdge+1) );
         return this._boundary.halfEdge(privyHfEdge);
      }
   }
   
   /**
    * skip over the internal edge.
    */
   prev(hEdge) {
      let privyHfEdge = this._edge._get( hEdge );
      
      if (privyHfEdge >= 0) {
         privyHfEdge = this._dEdge.prev( privyHfEdge );
         return this._dEdge.halfEdge(privyHfEdge);
      } else {
         privyHfEdge = this._boundary.prev(-(privyHfEdge+1));
         return this._boundary.halfEdge(privyHfEdge);
      }
   }

   pair(hEdge) {
      return hEdge ^ 1;
   }
   
   face(hEdge) {
      return this._face.get(hEdge, 0);
   }

   setFace(hEdge, face) {
      this._face.set(hEdge, 0, face);
   }
   
   half(hfEdge) {
      return this._edge.get(hfEdge, 0);
   }
   
   setHalf(hfEdge, value) {
      this._edge.set(hfEdge, 0, value);
   }
}




class WholeEdgeArray extends PixelArrayGroup {
   constructor(wEdge, fmm) {
      super(fmm);
      this._sharpness = wEdge?.sharpness;
      this._id = wEdge?.id;
      this.half = wEdge.half;
   }
   
   get _freeSlot() {
      return this._id;
   }
   
   * _baseEntries() {
      yield ["_sharpness", this._sharpness];
      yield ["_id", this._id];
   }
   
   static create(size) {
      const wEdgeArray = {
         sharpness: Float32PixelArray.create(1, 1, size),         // crease weights is per wEdge, sharpness is float, (int is enough, but subdivision will create fraction, so needs float)
         id: Int32PixelArray.create(1, 1, size),                  // realID, exist as side of polygon. no id then it internal edges.
         half: HalfEdgeArray.create(size),
      };
      
      return new WholeEdgeArray(wEdgeArray, {});
   }
   
   _rehydrate(self) {
      super._rehydrate(self);
      this.half = HalfEdgeArray.rehydrate(self.half);
   }
   
   static rehydrate(self) {
      const ret = new WholeEdgeArray({}, {});
      ret._rehydrate(self);
      return ret;
   }

   getDehydrate(obj) {
      super.getDehydrate(obj);

      obj.half = this.half.getDehydrate({});

      return obj;
   }

   compactBuffer(hole) {
      const b = this.half.b.compactBuffer(hole, this);
      // TODO: comppact all other buffer

      return {b};
   }
   
   // memory routines
   computeBufferSize(length) {
      return super.computeBufferSize(length) +
              this.half.computeBufferSize(length*2);
   }
   
   setBuffer(bufferInfo, byteOffset, length) {
      byteOffset = super.setBuffer(bufferInfo, byteOffset, length);
      if (!bufferInfo) {   // get the newly located one from super.setBuffer.
         bufferInfo = this._sharpness._blob.bufferInfo;
      }

      return this.half.setBuffer(bufferInfo, byteOffset, length*2);
   }
   
   _allocArray(count) {
      this.half._allocArray(count*2);
      return super._allocArray(count);
   }
   
   free(whEdge) {
      super.free(whEdge);
      const left = whEdge*2;
      // free handling needs is taken by WholeEdgeArray
      this.half.setFace(left, HoleK.end);
      this.half.setFace(left+1, HoleK.end);
   }
   
   isFree(whEdge) {
      const left = whEdge*2;
      return this.half.face(left) === this.half.face(left+1);
   }


   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this.length());
   }
   
   /**
    * walk over the wholeEdgeArray
    */
   * rangeIter(start, stop) {
      stop = Math.min(this.length(), stop);
      let leftRight = [0, 0];
      for (let i = start; i < stop; i++) {
         const sharpness = this._sharpness.get(i, 0);
         if (sharpness >= 0) {  // existed.
            this.half._edge.getVec2(i*2, 0, leftRight);
            yield [i, leftRight[0], leftRight[1]];
         }
      }
   }
   
   /**
    * iterate over faces's inner halfEdge starting from input hEdge to end hEdge
    * @param {number} current - start of face hfEdge loop.
    * @param {number) end - end of face hfEdge loop.
    */
   * aroundF(current, end) {
      //if (start !== HalfEdgeK.end) {
         do {
            yield current;
            current = this.next(current);
         } while (current !== end);
      //}
   }
      
   * inAroundV(currentIn, end) {
      //if (currentIn !== HalfEdgeK.end) {
         do {
            yield currentIn;
            currentIn = this.next( currentIn ) ^ 1;
         } while (currentIn !== end);
      //}
   }

   * outAroundV(currentOut, end) {
      //if (currentOut !== HalfEdgeK.end) {
         do {
            yield currentOut;
            currentOut = this.next( currentOut ^ 1 );         
         } while (currentOut !== end);
      //}
   }
   
   /**
    * looping over face.
    * next()/prev(). skip over the internal edge if any.
    * consolidated as internal function.
    * 
    */
   next(hEdge) {
      const end = hEdge;
      do {
         hEdge = this.half.next(hEdge);
         if (!this.isInterior(hEdge)) {
            return hEdge;
         }
         // skip interior edge
         hEdge = hEdge ^ 1;            // halfEdge twin.
      } while (hEdge !== end);
      throw("something went wrong in skipHop");
   }

   //
   // end of iterator
   //
   
   left(wEdge) {
      return wEdge * 2;
   }

   right(wEdge) {
      return (wEdge * 2) + 1;
   }
   
   sharpness(wEdge) {
      return this._sharpness.get(wEdge, 0);
   }
   
   setSharpness(wEdge, sharpness) {
      this._sharpness.set(wEdge, 0, sharpness);
   }
   
   whole(wEdge, value=[0,0]) {
      this.half._edge.getVec2(wEdge*2, 0, value);
      return value;
   }  
    
   setWhole(wEdge, left, right) {
      this.half._edge.setValue2(wEdge*2, 0, left, right);
   }
   
   setWhole2(wEdge, leftRight) {
      this.half._edge.setVec2(wEdge*2, 0, leftRight);
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
   
   
   sanityCheck() {
      for (let [i, left, right] of this) {
         i *= 2;
         let half = this.half._dEdge.halfEdge(left);
         if (half !== i) {
            console.log("DirectedEdge inconsistent HalfEdge");
         }
         if (right < 0) {
            half = this.half._boundary.halfEdge(-(right+1));
         } else {
            half = this.half._dEdge.halfEdge(right);
         }
         if (half !== (i+1)) {
            console.log("Internal Edge's halfEdge is inconsistent");
         }
      }
/*      const wEdgeArray = this.w;
      let length = this.length();
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
      } */

      return true;
   }
   
   stat() {
      return "WholeEdge Count: " + this.length() + ";\nDirectedEdge Count: " + this.half.d.length()*3 + ";\n";
   }
   
   static addUV(wholeEdgeArray, index=0) {
      return TriangleEdgeArray.addUV(wholeEdgeArray.half._dEdge, index);
   }
}



export {
//   HalfEdgeArray,
   WholeEdgeArray,
}
