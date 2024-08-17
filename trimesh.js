/**
   directed edges for triangles(can be used for quads) only meshes. halfEdges with implicit triangles.
   S. Campagna, L. Kobbelt, H.-P. Seidel, Directed Edges - A Scalable Representation For Triangle Meshes , ACM Journal of Graphics Tools 3 (4), 1998.

   The idea of FreeEdge(boundary edge) is the key in making DirectedEdge works like HalfEdge. 
   boundaryLoop is handle by negative value and separate array for pairing/next/prev traversal.

   Note: Gino van den Bergen has an interesting implementation. http://www.dtecta.com/files/GDC17_VanDenBergen_Gino_Brep_Triangle_Meshes.pdf
*/

import {SurfaceMesh, FaceArray, HoleArray, HalfEdgeArray, VertexArray} from './surfacemesh.js';
import {Int32PixelArray, Float32PixelArray} from './pixelarray.js';


const kNextEdge = [1, 2, 0, 1];
//const kPrevEdge = [2, 0, 1];
/** 
 * triangle use 3 directEdge(HalfEdge) as an unit
 * 
 */
class TriangleEdgeArray extends HalfEdgeArray {
   constructor(internal) {
      super(...internal);
   }
   
   static create(size) {
      const params = HalfEdgeArray._createInternal(size);

      return new TriangleEdgeArray(params);
   }

   static rehydrate(self) {
      const params = HalfEdgeArray._rehydrateInternal(self);
      return new TriangleEdgeArray(params);
   }
/*
   getDehydrate(obj) {
      return super.getDehydrate(obj);
   } */
   
   /**
    * iterate over face's inner edge staring from input hEdge
    */
   * faceIter(hEdge) {
      yield (hEdge);
      yield (hEdge+1) % 3;
      yield (hEdge+2) % 3;
   }

   /* DELETED
   alloc(face) {   // alloc 3 directedEdge.
      const hEdge = face * 3;
      const handle = this._allocDirectedEdge(hEdge, 3);
      return hEdge;
   } */

   next(dEdge) {
      if (dEdge >= 0) {
         //let i = (dEdge+1) % 3;                // remainder.
         //dEdge = Math.trunc(dEdge/3) * 3;
         //return  dEdge + i;
         const i = dEdge % 3;
         return dEdge - i + kNextEdge[i];
      } else {
         return this._hArray.next.get(-(dEdge+1), 0);
      }
   }
   
   prev(dEdge) {
      if (dEdge >= 0) {
         //let i = (dEdge+2) % 3;                // prev
         //dEdge = Math.trunc(dEdge/3) * 3;
         //return dEdge + i;
         const i = dEdge % 3;
         return dEdge - i + kNextEdge[i+1];
      } else {
         return this._hArray.prev.get(-(dEdge+1), 0);
      }
   }
   
   /**
    * assumed dEdge >= 0.
    */
   face(dEdge) {
      if (dEdge >= 0) {
         return Math.trunc(dEdge/3);
      } else {
         return this._hArray.hole.get(-(dEdge+1), 0);
      }
   }
}



class TriangleArray extends FaceArray {
   constructor(internal) {
      super(...internal);
   }
   
   static create(materialDepot, size) {
      const internal = FaceArray._createInternal(materialDepot, size);
      return new TriangleArray(internal);
   }

   static rehydrate(self) {
      const params = FaceArray._rehydrateInternal(self);
      return new TriangleArray(params);
   }
/*
   getDehydrate(obj) {
      return super.getDehydrate(obj);
   } */
   

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
   
   /* DELETED
    * _allocEx(count) {
      //this.setHalfEdge(handle, -1);  // note: needs?
      return this._faces.allocEx(count);
   }*/
   
   free(handle) {
      throw("not implemented");
      this._depot.releaseRef(this.material(handle));
      // this._faces.free(handle);
   }
   
   halfEdgeCount(_hEdges, _tri) {   // triangle is 3 side
      return 3;
   }
   
   halfEdge(tri) {
      return tri*3;
   }
   
   stat() {
      return "Triangle Count: " + this.length() + ";\n";
   }   
}


function isSame(as, bs) {
   return as.size === bs.size && [...as].every(value => bs.has(value));
}


class TriangleMesh extends SurfaceMesh {
   constructor(dEdges, vertices, faces, holes, internal) {
      super(dEdges, vertices, faces, holes, ...internal);
   }

   static create(materialDepot, size) {
      const params = SurfaceMesh._createInternal(materialDepot);

      const dEdges = TriangleEdgeArray.create(size);
      const vertices = VertexArray.create(size);
      const faces = TriangleArray.create(params[1].proxy, size);
      const holes = HoleArray.create(size);

      return new TriangleMesh(dEdges, vertices, faces, holes, params);
   }

   static rehydrate(self) {
      if (self._hEdges && self._vertices && self._faces && self._holes) {
         const params = SurfaceMesh._rehydrateInternal();
         const dEdges = TriangleEdgeArray.rehydrate(self._hEdges);
         const vertices = VertexArray.rehydrate(self._vertices, dEdges);
         const faces = TriangleArray.rehydrate(self._faces, dEdges);
         const holes = HoleArray.rehydrate(self._holes, dEdges);

         return new TriangleMesh(dEdges, vertices, faces, holes, params);
      }
      throw("TriangleMesh rehydrate(): bad input");
   }

   getDehydrate(obj) {
      super.getDehydrate(obj);
      obj._hEdges = this._hEdges.getDehydrate({});
      obj._vertices = this._vertices.getDehydrate({});
      obj._faces = this._faces.getDehydrate({});
      obj._holes = this._holes.getDehydrate({});

      return obj;
   }
   
   _computeNormal() {
      this.v.computeLoopNormal(this.h);
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
   TriangleMesh,
}
