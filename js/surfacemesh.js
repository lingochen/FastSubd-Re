/**
 * DirectedEdge instead of traditional HalfEdge. 
 * Same operation as HalfEdge, implicit next/prev and explicit pair data member.
 * Traditional HalfEdge is explicit next/prev but implicit pair data member.
 * AddFace() different logic from HalfEdge.
 * better cache coherence and more similar to traditional face/vertex representation.
 * easier to optimize for parallel subdivision.
 * Only triangle mesh here, general polygon is better handle by traditional HalfEdge. (2024/08/14)
 * Now handle general polygon. Use triangles to fill the polygon. (2025/03/03)
 * Use WholeEdge/HalfEdge as container instead of TriangleEdgeArray. The reverse of original design.
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
 * Provided 7 classes.
 * BoundaryArray
 * TriangleEdgeArray
 * WholeEdgeArray
 * TriangleArray => FaceArray
 * HoleArray
 * TriangleMesh => SurfaceMesh
 * 
 * Note: Gino van den Bergen has an interesting implementation. http://www.dtecta.com/files/GDC17_VanDenBergen_Gino_Brep_Triangle_Meshes.pdf
 */
 

import {Int32PixelArray, Float32PixelArray, Uint8PixelArray, Float16PixelArray, allocBuffer, PixelArrayGroup, ExtensiblePixelArrayGroup} from './pixelarray.js';
import {vec3, vec3a} from "./vec3.js";
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


class WholeEdgeArray extends PixelArrayGroup {
   constructor(wEdge, fmm) {
      super(fmm);
      this._edge = wEdge?.edge;                 // [left, right] array
      this._face = wEdge?.face;                 // [face/hole, face/hole] pointer.
      this._sharpness = wEdge?.sharpness;
      this._id = wEdge?.id;
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
      return this._id;
   }
   
   * _baseEntries() {
      yield ["_edge", this._edge];
      yield ['_face', this._face];
      yield ["_sharpness", this._sharpness];
      yield ["_id", this._id];
   }
   
   static create(size) {
      const wEdgeArray = {
         edge: Int32PixelArray.create(wEdgeK.sizeOf, 2, size),    // [left, right]
         face: Int32PixelArray.create(wEdgeK.sizeOf, 2, size),    // point back to face/hole
         sharpness: Float32PixelArray.create(1, 1, size),         // crease weights is per wEdge, sharpness is float, (int is enough, but subdivision will create fraction, so needs float)
         id: Int32PixelArray.create(1, 1, size),                  // realID, exist as side of polygon. no id then it internal edges.
         dEdge: TriangleEdgeArray.create(size),
         boundary: BoundaryArray.create(size),
      };
      
      return new WholeEdgeArray(wEdgeArray, {});
   }
   
   _rehydrate(self) {
      super._rehydrate(self);
      
      this._boundary = BoundaryArray.rehydrate(self._boundary);
      this._dEdge = TriangleEdgeArray.rehydrate(self._dEdge);
   }
   
   static rehydrate(self) {
      const ret = new WholeEdgeArray({}, {});
      ret._rehydrate(self);
      return ret;
   }

   compactBuffer(hole) {
      const b = this.b.compactBuffer(hole, this);
      // TODO: comppact all other buffer

      return {b};
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
      for (let i = start; i < stop; i++) {
         const sharpness = this.sharpness(i);
         if (sharpness >= 0) {  // existed.
            this._edge.getVec2(i, 0, leftRight);
            yield [i, leftRight[0], leftRight[1]];
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
    * generic circulator, for aroundFace, aroundVertex, and
    */
   * circulator(current, end, step) {
      //if (current !== HalfEdgeK.end) {
      do {
         yield current;
         current = step.call(this, current);
      } while (current !== end);
      //}
   }

   /**
    * iterate over faces's inner halfEdge starting from input hEdge
    * 
    * @param {number} start - start and end of face hfEdge loop.
    */
   * halfEdgeAroundFace(start) {//, end = start) {
      //if (start !== HalfEdgeK.end) {
         let current = start;
         do {
            yield current;
            current = this.next(current);
         } while (current !== start);
      //
   }
   
   * outHalfEdgeAroundVertex(currentOut, end) {
      //if (currentOut !== HalfEdgeK.end) {
         do {
            yield currentOut;
            currentOut = this.next( this.pair(currentOut) );         
         } while (currentOut !== end);
      //}
   }
      
   * inHalfEdgeAroundVertex(currentIn, end) {
      //if (currentIn !== HalfEdgeK.end) {
         do {
            yield currentIn;
            currentIn = this.pair( this.next( currentIn ) );
         } while (currentIn !== end);
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
         hEdge = this._edge._get(hEdge^1);
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
         hEdge = this._edge.get(hEdge^1);
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
    * used for circling over vertex
    */
   _stepOverAround(hEdge) {
      hEdge = hEdge ^ 1;      // get pair
      return this._stepOver(hEdge, this._dEdge.next, this._boundary.next);
   }
   
   /**
    * used for circling over vertex
    */
   _stepAround(hEdge) {
      hEdge = hEdge ^ 1;      // get pair
      return this._step(hEdge, this._dEdge.next, this._boundary.next);
   }
   
   /**
    * circling over face.
    * next()/prev(). skip over the internal edge if any.
    * consolidated as internal function.
    * 
    */
   _stepOver(hEdge, stepTri, stepB) {
      const start = hEdge;
      do {
         hEdge = this._step(hEdge, stepTri, stepB);
         if (!this.isInterior(hEdge)) {
            return hEdge;
         }
         // stepOver interior edge
         hEdge = hEdge ^ 1;            // halfEdge twin.
      } while (start !== hEdge);
   }
   
   _step(hEdge, stepTri, stepB) {
      let privyHfEdge = this._edge._get( hEdge );
      
      if (privyHfEdge >= 0) {
         privyHfEdge = stepTri.call(this._dEdge, privyHfEdge);
         return this._dEdge.halfEdge(privyHfEdge);
      } else {
         privyHfEdge = stepB.call(this._boundary, -(privyHfEdge+1));
         return this._boundary.halfEdge(privyHfEdge);
      }
   }
   
   _next(hEdge) {
      return this._step(hEdge, this._dEdge.next, this._boundary.next);
   }
   
   /**
    * next polygon edge. skip over the internal edge if any
    * 
    */
   next(hEdge) {
      return this._stepOver(hEdge, this._dEdge.next, this._boundary.next);
   }
   
   _prev(hEdge) {
      return this._step(hEdge, this._dEdge.prev, this._boundary.prev);
   }
   
   /**
    * skip over the internal edge.
    */
   prev(hEdge) {
      return this._stepOver(hEdge, this._dEdge.prev, this._boundary.prev);
   }
   
   _left(wEdge) {
      return this._edge.get(wEdge, wEdgeK.left);
   }
   
   left(wEdge) {
      return wEdge * 2;
   }

   _pair(hEdge) {
      return this._edge._get( hEdge ^ 1 );   // left to right, right to left
   }
   
   pair(hEdge) {
      return hEdge ^ 1;
   }
   
   _right(wEdge) {
      return this._edge.get(wEdge, wEdgeK.right);
   }
   
   right(wEdge) {
      return (wEdge * 2) + 1;
   }
   
   face(hEdge) {
      return this._face._get(hEdge);
   }

   setFace(hEdge, face) {
      this._face._set(hEdge, face);
   }
   
   whole(wEdge, value=[0,0]) {
      this._edge.getVec2(wEdge, 0, value);
      return value;
   }
   
   half(hfEdge) {
      return this._edge._get(hfEdge);
   }
   
   setHalf(hfEdge, value) {
      this._edge._set(hfEdge, value);
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
   
   stat() {
      return "WholeEdge Count: " + this.length() + ";\nDirectedEdge Count: " + this.d.length()*3 + ";\n";
   }

   sanityCheck() {
      this._boundary.sanityCheck();
      for (let [i, left, right] of this) {
         i *= 2;
         let half = this._dEdge.halfEdge(left);
         if (half !== i) {
            console.log("DirectedEdge inconsistent HalfEdge");
         }
         if (right < 0) {
            half = this._boundary.halfEdge(-(right+1));
         } else {
            half = this._dEdge.halfEdge(right);
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
   
   static addUV(halfEdgeArray, index=0) {
      return TriangleEdgeArray.addUV(halfEdgeArray._dEdge, index);
   }
}




class FaceArray extends ExtensiblePixelArrayGroup {
   constructor(materialDepot, array, prop, fmm) {
      super(prop, fmm);
      this._material = array?.material;
      this._hfEdge = array.hfEdge;
      this._numberOfSide = array.numberOfSide;
      this._depot = materialDepot;
   }
   
   get _freeSlot() {
      return this._material;
   }
   
   * _baseEntries() {
      yield ["_material", this._material];
      yield ["_hfEdge", this._hfEdge];
      yield ["_numberOfSide", this._numberOfSide];
   }

   static rehydrate(self) {
      const ret = new FaceArray(null, {}, {}, {});  
      ret._rehydrate(self);
      return ret;
   }

   static create(depot, size) {
      const array = {
         material: Int32PixelArray.create(1, 1, size),
         hfEdge: Int32PixelArray.create(1, 1, size),
         numberOfSide: Int32PixelArray.create(1, 1, size),
      };
      const fmm = {};
      
      return new FaceArray(depot, array, {}, fmm);
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
   
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this.length());
   }

   * rangeIter(start, stop) {
      stop = Math.min(this.length(), stop);
      for (let i = start; i < stop; i++) {
         yield i;
      }
   }
   
   * vertexAround(hEdgeContainer, face) {
      for (const hEdge of this.halfEdgeAround(hEdgeContainer, face)) {
         yield hEdgeContainer.origin(hEdge);
      }
   }
   
   /* * wEdgeLoop(face) {
   } */
   
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
   
   /**
    * iterator for the halfEdge loop that form the polygon.
    * 
    */
   * halfEdgeAround(hfEdgeContainer, face) {
      const start = this.halfEdge(face);
      yield* hfEdgeContainer.halfEdgeAroundFace(start);
   }
   
   /**
    * similar to array.entries. return [index, element]
    * @param {handle} face 
    */
   * halfEdgeAroundEntries(hfEdgeContainer, face) {
      const start = this.halfEdge(face);
      let i = 0;
      for (let hfEdge of hfEdgeContainer.halfEdgeAroundFace(start)) {
         yield [i++, hfEdge];
      }
   }
   
   halfEdgeCount(_hEdges, polygon) {
      return this._numberOfSide.get(polygon, 0);
   }
   
   halfEdge(face) {
      return this._hfEdge.get(face, 0);
   }   
   
   setHalfEdge(handle, hEdge) {
      this._hfEdge.set(handle, 0, hEdge);
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
         //for (let hEdge of this.halfEdgeAround(hEdgeContainer, face)) {
         //   const pair = hEdgeContainer.pair(hEdge);
            //if (hEdgeContainer.isBoundary(pair)) {
            //   console.log("polygon: " + face + " has boundary: " + pair + " on hEdge: " + hEdge);
            //}
         //}
      }
      return true;
   }
   
   stat() {
      return "Polygon Count: " + this.length() + ";\n";
   }  
}


/**
 * BoundaryLoop aka HoleArray
 */
class HoleArray extends PixelArrayGroup {
   constructor(holes) {
      super({});
      this._hfEdge = holes?.hfEdge;
      this._numberOfSide = holes?.numberOfSide;
   }
   
   get _freeSlot() {
      return this._hfEdge;
   }
   
   * _baseEntries() {
      yield ["_hfEdge", this._hfEdge];
      yield ["_numberOfSide", this._numberOfSide];
   }

   static create(buffer, byteOffset, length) {
      const base = {
         hfEdge: Int32PixelArray.create(1, 1),
         numberOfSide: Int32PixelArray.create(1, 1),
      }

      return new HoleArray(base);
   }

   static rehydrate(self) {
      const holes = new HoleArray({});
      holes._rehydrate(self);
      return holes;
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
      const len = this._hfEdge.length();
      for (let i = 0; i < len; ++i) {
         if (!this._isFree(i)) {
            yield i;
         }
      }
   }

   * halfEdgeAround(hEdgeContainer, hole) {
      const start = this.halfEdge(hole);
      let current = start;
      do {
         yield current;
         current = hEdgeContainer._next(current);
      } while (current !== start);
   }
   
   free(handle) {
      // assume handle is valid
      if (handle >= 0) {
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

   halfEdge(handle) {
      return this._hfEdge.get(handle, 0);
   }

   numberOfSide(handle) {
      return this._numberOfSide.get(handle, 0);
   }

   setHalfEdge(handle, hEdge) {
      if (handle >= 0) {
         this._hfEdge.set(handle, 0, hEdge);
      } else {
         throw("invalid hole: " + handle);
      }
   }
   
   setNumberOfSide(handle, sides) {
      if (handle >= 0) {
         this._numberOfSide.set(handle, 0, sides);
      } else {
         throw("invalid hole: " + handle);
      }
   }

   sanityCheck(hEdgeContainer) {
      let sanity = true;
      for (let hole of this) {
         for (let hEdge of this.halfEdgeAround(hEdgeContainer, hole)) {
            const holeCheck = -(hEdgeContainer.face(hEdge)+1);
            if (holeCheck !== hole) {
               sanity = false;
               break;
            }
         }
      }
      return sanity;
   }

   stat() {
      return "Holes Count: " + this.size() + ";\n";
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

   finalizeEdit(end) {
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

      const dEdges = WholeEdgeArray.create(size);
      const vertices = VertexArray.create(size);
      const faces = FaceArray.create(params[1].proxy, size);
      const holes = HoleArray.create(size);

      return new TriangleMesh(dEdges, vertices, faces, holes, ...params);
   }   

   static _createInternal(materialDepot) {
      const bin = {nameGroup:[], };

      // we do per mesh accounting. But, does counting at end of release cycle make more sense?
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
         const hEdges = WholeEdgeArray.rehydrate(self._hEdges);
         const vertices = VertexArray.rehydrate(self._vertices, dEdges);
         const faces = FaceArray.rehydrate(self._faces, dEdges);
         const holes = HoleArray.rehydrate(self._holes, dEdges);

         return new TriangleMesh(hEdges, vertices, faces, holes, ...params);
      }
      throw("SurfaceMesh rehydrate(): bad input");
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
    * @param {int} nWEdges = number of WholeEdges
    */
   reserve(nVertices, nEdges, nTris, nBoundaries, nFaces, nHoles, isStatic=true) {
      // padded to rectData dimension.
      nVertices = this._vertices.textureAlignLen(nVertices);
      nEdges = this._hEdges.textureAlignLen(nEdges);
      nTris  = this._hEdges.d.textureAlignLen(nTris);
      nBoundaries = this._hEdges.b.textureAlignLen(nBoundaries);
      nFaces = this._faces.textureAlignLen(nFaces);
      nHoles = this._holes.textureAlignLen(nHoles);
      
      if (isStatic) {
         const totalBytes = this._vertices.computeBufferSize(nVertices)
                          + this._hEdges.computeBufferSize(nEdges)
                          + this._hEdges.d.computeBufferSize(nTris)
                          + this._hEdges.b.computeBufferSize(nBoundaries)
                          + this._faces.computeBufferSize(nFaces)
                          + this._holes.computeBufferSize(nHoles);
      
         // reserve total linear memory
         const newBuffer = allocBuffer(totalBytes);
         // set new buffer and copy over if necesary.
         let byteOffset = this._vertices.setBuffer(newBuffer, 0, nVertices);
         //console.log("offset: " + byteOffset);
         byteOffset = this._hEdges.setBuffer(newBuffer, byteOffset, nEdges);
         byteOffset = this._hEdges.setBuffer(newBuffer, byteOffset, nTris);
         byteOffset = this._hEdges.setBuffer(newBuffer, byteOffset, nBoundaries);
         //console.log("offet: " + byteOffset);
         byteOffset = this._faces.setBuffer(newBuffer, byteOffset, nFaces);
         //console.log("offset: " + byteOffset);
                      this._holes.setBuffer(newBuffer, byteOffset, nHoles);
      } else { // reserve linear memory separately for dynamic resizing
         this._vertices.setBuffer(null, 0, nVertices);
         this._hEdges.setBuffer(null, 0, nEdges);
         this._hEdges.d.setBuffer(null, 0, nTris);
         this._hEdges.b.setBuffer(null, 0, nBoundaries);
         this._faces.setBuffer(null, 0, nFaces);
         this._holes.setBuffer(null, 0, nHoles);
      }
   } 
   
   
   /**
    * circle around vertex, return inEdge(point toward vertex).
    * 
    */
   * inHalfEdgeAroundVertex(vert, stepAround=this._hEdges._stepAroundOver) {
      if (this._vertices.hasHalfEdge(vert)) {
         const outEdge = this._vertices.halfEdge(vertices);
         for (let out of this._hEdges.circulator(outEdge, outEdge, stepAround)) {
            yield this._hEdges.pair(out);
         }
      }
   }
   
   /**
    * circle around vertex, return outEdge.
    */
   * outHalfEdgeAroundVertex(vert, stepAround= this._hEdges._stepAroundOver) {
      if (this._vertices.hasHalfEdge(vert)) {
         const outEdge = this._vertices.halfEdge(vert);
         yield* this._hEdges.circulator(outEdge, outEdge, stepAround);
      }
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
      const uvsTexture = this.h.d.createPropertyTexture('uv0', gl);
      
      const pbrTexture = this._material.depot.createTexture(gl);
      const materialTexture = this.f.createMaterialTexture(gl);
      
/*      const materials = [];
      for (let [handle, count] of this._material.used) {
         materials.push( this._material.depot.getUniforms(handle) );
      }*/
      
      return {pullLength: this.h.d.length()*3,
              vertex: {type:"isampler2D", value: vertexTexture},
              position: {type:"sampler2D", value: positionTexture}, 
              normal: {type:"sampler2D", value: normalTexture},
              uvs: {type: "sampler2DArray", value: uvsTexture},
              pbr: {type: "sampler2D", value: pbrTexture},
              material: {type: "sampler2D", value: materialTexture},
             };
   }
 
   
   /**
    * free unused memory from all the pixel's array.
    * TODO: 
    */
   shrink() {
      
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
      changed.h = this.h.compactBuffer(this.o);
      
      return changed;
   }

   // post process
   // fill boundaryLoop with holes.
   fillBoundary() {
      // walk through all unassigned boundaryEdge, assign hole to each boundary group.
      for (let boundary of this._hEdges.unassignedBoundary()) {
            let hole = this._holes.alloc();
            this._holes.setHalfEdge(hole, boundary);
            let sides = 0;
            // assigned holeFace to whole group
            for (let current of this._hEdges.circulator(boundary, boundary, this._hEdges._next)) {
               this._hEdges.setSharpness(current, -1);   // boundary is infinite crease.
               this._hEdges.setFace(current, -(hole+1));
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
   finalizeEdit() {
      this.fillBoundary();
      // now compute valence, crease 
      this.v.computeValence(this.h);
      this._computeNormal();       // and normal?
      // commpaction
      this.compactBuffer();
   }
   
   findHalfEdge(v0, v1) {
      for (let outEdge of this._vertices.outHalfEdgeAround(this._hEdges, v0)) {
         if (this._hEdges.destination(outEdge) === v1) {
            return outEdge;
         }
      }
      return -1;
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
   addFace(pts, material) {
      const newPoly = this._faces.alloc(material);
      
      const tri = [];
      const triIdx = [0, 1, 2];
      const triPts = [pts[0], 0, 0];
      const length = pts.length;
      for (let i = 2; i < length; ++i) {
         triPts[1] = pts[i-1];
         triPts[2] = pts[i];
         tri.push( this._addTriangle(triIdx, triPts, material) );
         this._hEdges.sanityCheck();
      }
      
      // polygon's halfEdge point to first triangle's first halfEdge.
      this._faces.setHalfEdge(newPoly, tri[0].halfEdge);
      return {success: tri[tri.length-1].success, polygon: newPoly, hLoop: tri[0].hLoop};
   }
   
   /**
    * assume normal triangle.
    * @param {array} idx - 3 index
    * @param {array} pts - point array
    * @returns {bool, number} - {ok/fail, halfEdge}
    */
   _addTriangle(idx, pts, material) {
      // create 3 directedEdges, and 3 boundaryLoops
      const vert = [pts[idx[0]], pts[idx[1]], pts[idx[2]]];
      const [dEdges, bEdges] = this._hEdges.allocTriangle(vert);  // alloc 3 directedEdges, and 3 boundaryLoops[
      
      // find splice freeEdge point.
      const halfEdges = [];
      for (let i=0; i < 3; ++i) {
         let v0 = vert[i];
         let v1 = vert[(i+1) % 3];
         let freeEdge = this.findFreeEdge(v0, v1);   // try to find matching freeIn
         halfEdges.push( freeEdge );
         if (freeEdge.found === 0) { // no place for insertion, this halfEdge would instroduce non-manifold condition.
            this._hEdges.freeTriangle(dEdges, bEdges);
            console.log("non-manifold condition");
            return {success: false};
         }
      }
      
      // fixup adjacency, make(in, out) correct
      for (let i = 0; i < 3; ++i) {
         let next = (i+1) % 3;
         if (halfEdges[i].found > 0) {
            if (halfEdges[next].found > 0) {
               this.makeAdjacent(halfEdges[i].outEdge, halfEdges[next].outEdge);
            } else { // no needs for splice to gap. done by merge. insert not possible
               halfEdges[next].found = 0;
            }
         }
      }
      
      const hLoop = []; // TEMP FIXED:
      const boundary = this._hEdges.b;
      // insert/splice or merge to boundary.
      for (let i = 0; i < 3; ++i) {
         if (halfEdges[i].found <= 0) {      // create new WholeEdge
            const wHandle = this._hEdges.alloc();
            this._hEdges.setWhole(wHandle, dEdges[i], -(bEdges[i]+1));
            this._hEdges.d.setHalfEdge(dEdges[i], wHandle*2);
            this._hEdges.b.setHalfEdge(bEdges[i], wHandle*2+1);
            if (halfEdges[i].found < 0) {       // insert/splice
               if (halfEdges[i].outEdge >= 0) { // splice to gap
                  const a = -(this._hEdges.half(halfEdges[i].outEdge) + 1);
                  const b = bEdges[i];
                  const c = boundary.prev(a);
                  if (b !== c) {                   // is already corrected?
                     const d = boundary.next(b);
                     boundary.linkNext(b, a);
                     boundary.linkNext(c, d);
                  }
               } else { // insert, set vertex's outEdge, since there is none before
                  this._vertices.setHalfEdge(vert[i], wHandle*2);
               }
            }
            // for return value, if (i) === 0;
            halfEdges[i].outEdge = wHandle*2;
         } else { // replace/merge boundary
            // fixup boundary link 
            const a = -(this._hEdges.half(halfEdges[i].outEdge) + 1);
            const b = bEdges[i];
            let c = boundary.prev(a);
            let d;
            if (c !== b) {
               d = boundary.next(b);
               boundary.linkNext(c, d);
            }
            c = boundary.next(a);
            if (c !== b) {
               d = boundary.prev(b);
               boundary.linkNext(d, c);
            }
            // collapsed both boundary edge
            boundary.free(a);
            boundary.free(b);
            // now replace boundary with directedEdge
            this._hEdges.setHalf(halfEdges[i].outEdge, dEdges[i]);
            this._hEdges.d.setHalfEdge(dEdges[i], halfEdges[i].outEdge);
         }
         hLoop.push( halfEdges[i].outEdge );
      }

      return {success: true, halfEdge: halfEdges[0].outEdge, hLoop};
   }

   
   /**
    * try to find the matching boundary pair if any,
    * @return {number} - 0=non-manifold, 1=found, -1=not found
   */
   findFreeEdge(v0, v1) {
      let freeEdge = -1;
      for (let outEdge of this.outHalfEdgeAroundVertex(v0, this._hEdges._stepAround)) {
         if (this._hEdges.destination(outEdge) === v1) {
            if (!this._hEdges.isBoundary(outEdge)) {  // non-free, non-manifold
               return {found: 0, outEdge};
            }
            return {found: 1, outEdge};
         } else if (this._hEdges.isBoundary(outEdge)) {
            freeEdge = outEdge;
         }
      }
      // return not-found, but append after freeEdge if applicable
      return {found: -1, outEdge: freeEdge};
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
               return current;
            }
            current = hEdges.pair( hEdges._next(current) );
         } while (current !== andBefore);
      }

      console.log("SurfaceMesh.addFace.findFreeInEdge: patch re-linking failed");
      return -1;
   }
   
   makeAdjacent(inEdge, outEdge) {
      const hEdges = this.h;
      let b = hEdges._next(inEdge);
      if (b === outEdge) {   // adjacency is already correct.
         return true;
      }

      let d = hEdges._prev(outEdge);
      // Find a free incident half edge
      // after 'out' and before 'in'.
      let g = this.findFreeInEdge(outEdge, inEdge);

      if (g >= 0) {
         hEdges._linkNext(inEdge, outEdge);
         if (g === d) {
            hEdges._linkNext(d, b);
         } else {
            let h = hEdges._next(g);
         
            hEdges._linkNext(g, b);

            hEdges._linkNext(d, h);
         }
         
         return true;
      }
      
      console.log("BaseMesh.makeAjacent: no free inEdge, bad adjacency");
      return false;
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
   WholeEdgeArray,
//   FaceArray,
//   HoleArray,
   TriangleMesh,
}
