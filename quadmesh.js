/**
 * QuadMesh, good for parallel subdivision. cc first subdivision will create all quad Mesh anyway. 
 * Dense representation in the most common cases.
 * 
 * this is quad optimized mesh, but capable of tri, penta, hexa... nGon. it a combination of trimesh and polymesh's ideas
 * 
 * we allocated nGon on negative halfEdge index, separate from quad Index. it makes computation much simpler.
 * nGon used the idea from original Polymesh but with explicit pair.
 */

import {SurfaceMesh, FaceArray, HoleArray, HalfEdgeArray, VertexArray} from './surfacemesh.js';
import {Int32PixelArray, Float32PixelArray, Float16PixelArray3D, Uint8PixelArray} from './pixelarray.js';



class QuadEdgeArray extends HalfEdgeArray {
   constructor(uvs, internal) {
      super(...internal);
      //if (uvs) {   // additional uvs for hArray if any?
         this._hArray.uvs = uvs;
      //}
   }
   
   static create(size) {
      //quadSize = Math.trunc(size/4);
      //size = quadSize * 4;
      const params = HalfEdgeArray._createInternal(size);
      const uvs = Float16PixelArray3D.create(1, 2, 2,  size);     // uv goes with edge          
      return new QuadEdgeArray(uvs, params);
   }
   
   static rehydrate(self) {
      const params = HalfEdgeAray._rehydrateInternal(self);
      const uvs = rehydrate(self._hArray.uvs);
      return QuadEdgeArray(uvs, params);
   }
   
   getDehydrate(obj) {      
      super.getDehydrate(obj);
      obj._hArray.uvs = this._hArray.uvs.getDehydrate({});
      return obj;
   }
   
   /**
    * return start of hEdge(dEdge).
    */
   alloc(face) {
      const hEdge = face * 4;
      const handle = this._allocDirectedEdge(hEdge, 4);
      return hEdge;
   }
   
   nGonAlloc(face, length) {
      // face should be negative
      const handleArray = this._allocHalfEdge(face, length, false);
      // return the lowest handle
      let lowest = handleArray[0];
      for (let handle of handleArray) {
         if (handle < lowest) {
            lowest = handle;
         }
      }
      return lowest;
   }
      
   /**
    * iterated over nGon halfEdges only. 
    */
   * _nGonEdgeIter() {
      for (let i = 0; i < this._hArray.vertex.length(); ++i) {
         //if (this._hArray.vertex.get(i, 0) >= 0)｛
            if (this._hArray.hole.get(i, 0) > 0) {    // nGon
               yield -(i+1);
            }
         //｝
      }
   }
   
   /**
    * iterate over face's inner edge staring from input hEdge
    */
   * faceIter(hEdge) {
      if (hEdge >= 0) {
         yield hEdge;
         yield (hEdge+1)%4;
         yield (hEdge+2)%4;
         yield (hEdge+3)%4;
      } else { // walking over nGon's inner Edge.
         const start = hEdge;
         do {
            yield hEdge;
            hEdge = this._hArray.next.get(-(hEdge+1), 0);   // next
         } while (hEdge !== start);
      }
   }
   
   setUV(hEdge, layer, uv) {  // override original
      if (hEdge >= 0) {
         this._dArray.uvs.setVec2(hEdge, 0, layer, uv);
      } else {
         this._hArray.uvs.setVec2(-(hEdge+1), 0, layer, uv);
      }
   }
   
   /**
    * return false if it hole, true if it polygon.
    * return faceID.handle - get handle to +/- face/face
    */
   face(dEdge, handle) {
      if (dEdge >= 0) { // normal quad
         handle.face = Math.trunc(dEdge/4); 
         return this._mesh.f;
      } else {             // check from halfEdge, either face or hole
         handle.face = this._hArray.hole.get(-(dEdge+1), 0);
         if (handle.face > 0) {   // positive is face, convert to negative value
            handle.face = -handle.face;
            return this.mesh.f;
         }
         return this._mesh.h;
      }
   }
   
   isBoundary(dEdge) {
      if (dEdge < 0) {  // halfEdge border on Hole is boundaryEdge. quadMesh reuse it.
         return this._hArray.hole.get(-(dEdge+1), 0) >= 0;     // should not be 0
      } 
      return false;
   }
   
   next(dEdge) {
      if (dEdge >= 0) {
         let i = (dEdge+1) % 4;                // remainder.
         dEdge = Math.trunc(dEdge/4) * 4;
         return (dEdge + i);
      } else {
         return this._hArray.next.get(-(dEdge+1), 0);
      }
   }
   
   prev(dEdge) {
      if (dEdge >= 0) {
         let i = (dEdge+3) % 4;                // prev
         dEdge = Math.trunc(dEdge/4) * 4;
         return dEdge + i;
      } else {
         return this._hArray.prev.get(-(dEdge+1), 0);
      }
   }
   
   /**
    * process the quad so it "edge friend" in structure.
    * rotate the halfEdge until it align with neighboring face.
    * 
    */
   makeEdgeFriend() {
      
   }
}


/**
 * QuadArray, optimized for Quad, but support triangle, and pentagon, hexagon....too.
 * 
 * 
 */
class QuadArray extends FaceArray {
   constructor(nGon, internal) {
      super(...internal);
      this._nGon = nGon;                  // management of nGon;
   }
   
   static create(materialDepot, size) {
      const internal = FaceArray._createInternal(materialDepot, size);
      const nGon = {
         material: Int32PixelArray.create(1, 1, size),
         color: Uint8PixelArray.create(4, 4, size),
         hEdge: Int32PixelArray.create(1, 1, size),            // point to handle.
         side: Int32PixelArray.create(1, 1, size),             // # of side of this faces, is uin8/int16 enough?
         freed: {
            size: 0,
            head: 0,   
         },
      };
      return new QuadArray(nGon, internal);
   }
   
   static rehydrate(self) {
      const params = FaceArray._rehydrateInternal(self);
      const nGon = {};
      nGon.material = rehydrate(self._nGon.material);
      nGon.color = rehydrate(self._nGon.color);
      nGon.hEdge = rehydrate(self._nGon.hEdge);
      nGon.side = rehydrate(self._nGon.side);
      nGon.freed = self._nGon.freed;
      return new QuadArray(nGon, params);
   }
   
   getDehydrate(obj) {
      super.getDehydrate(obj);
      obj._nGon = {}
      for (let prop of ['material', 'color', 'hEdge', 'side']) {
         obj._nGon[prop] = this._nGon[prop].getDehydrate({});
      }
      obj._nGon.freed = this._nGon.freed;
      
      return obj;
   }
   
   addProperty(name, type) {
      //if (isValidVarName(name)) {
         if (this._prop[name] === undefined) { // don't already exist
            // create DynamicProperty for accessing data
            this._prop[name] = createDynamicProperty2(type, this.length());
         }
      //}
      return false;
   }
   
   /**
    * triangulate polygon using fan-like method. (simple, flawed but good enough for our case)
    * list of triangles of pull vertex - (hEdgeIndex, ptIndex, materialIndex} - pull vertex.
    * NOTE: can we use multidraw to draw quad individually, so a lot of data can be implicit infered?
    */
   makePullBuffer(vertices) {
      const triangles = [];

      for (let polygon of this) {
         let material = this.material(polygon);
         let currentIdx = 0;
         
         for (let hEdge of this.halfEdgeLoop(polygon)) {
            if (currentIdx++ > 2) {   // copy the last virtual edge
               let v0 = triangles.length - (3*3);
               let v1 = triangles.length - 3;
               triangles.push( triangles[v0], triangles[v0+1], triangles[v0+2],
                               triangles[v1], triangles[v1+1], triangles[v1+2] );
            }
            triangles.push( hEdge, this._mesh.h.origin(hEdge), material );
         }
      }
      
      return new Int32Array(triangles);
   }
   
      
   *[Symbol.iterator] () {
      yield* this.rangeIter(0, this.length());
      yield* this.nGonRangeIterator(0, this.nGonLength());
   }
   
   * nGonRangeIterator(start, stop) {
      for (let i = 0; i < stop; ++i) {
         yield -(i+1);
      }
   }
      
   nGonLength() {
      return this._nGon.material.length();
   }
   
   /**
    * return faceHandle, (negativeHandle is nGon).
    * the hEdge we are pointing - quad optimized.
    */
   nGonAlloc(material, side) {
         // grab handle from nGon
         let handle;
         if (this._nGon.freed.size > 0) { // any freed for the taking?
            handle = this._nGon.freed.head ;
            this._nGon.head = this._nGon.material.get(-(handle+1), 0);
            --this._nGon.size;
         } else { // increment nGon size
            handle = -(this._nGon.material.alloc() + 1);
            this._nGon.color.alloc();
         }
         
         this._nGon.side.set(-(handle+1), 0, side);
         // now setup material
         if (material == null) {
            material = this._depot.getDefault();
         }
         this.setMaterial(handle, material);
         this._depot.addRef(material, 1);
         return handle;
      
   }
   
   // Iterator for the HalfEdge/DirectedEdge to the nGon/quad
   * halfEdgeLoop(fHandle) {
      if (fHandle >= 0) {  // optimized code path.
         let hEdge = fHandle * 4;
         yield hEdge;
         yield hEdge+1;
         yield hEdge+2;
         yield hEdge+3;
      } else {
         // fetch hEdge first
         const head = this._nGon.hEdge.get(-(fHandle+1), 0);
         let current = head;
         do {
            yield current;
            current = this._mesh.h.next(current);
         } while (current !== head);
      }
   }
   
   /**
    * similar to array.entries
    * @param {handle} face 
    */
   * halfEdgeLoopEntries(face) {
      let i = 0;
      for (let hEdge of this.halfEdgeLoop(face)) {
         yield [i++, hEdge];
      }
   }
   
   halfEdgeLoopArray(fHandle) {
      if (fHandle >= 0) {
         fHandle *= 4;
         return [fHandle, fHandle+1, fHandle+2, fHandle+3];
      } else { // nGon, 
         const halfLoop = [];
         for (let hEdge of this.halfEdgeLoop(fHandle)) {
            halfLoop.push( hEdge );
         }
         return halfLoop;
      }
   }
   
   halfEdgeCount(nGon) { 
      if (nGon >= 0) {
         return 4;
      } else {
         return this._nGon.side.get(-(nGon+1), 0);
      }
   }
   
   halfEdge(handle) {
      if (handle >= 0) {
         return handle*4;
      } else {
         this._nGon.hEdge.get(-(handle+1), 0);
      }
   }
   
   setHalfEdge(handle, hEdge) {
      if (handle < 0) { // set nGon's initial hEdge.
         this._nGon.hEdge.set(-(handle+1), 0, hEdge);
         // also 
      }
      // handle >= 0, implicit, no setting possible.
   }
   
   setNumberOfSide(nGon, count) {
      if (nGon < 0) {
         this._nGon.side.set(-(nGon+1), 0, count);
      }
   }
   
   numberOfSides(fHandle) {
      if (fHandle >= 0) {
         return 4;         // default to quad
      } else {
         return this._nGon.side.get(-(fHandle+1), 0);
      }
   }
   
   material(handle) {
      if (handle >= 0) {
         return super.material(handle);
      } else {
         return this._nGon.material.get(-(handle+1), 0);
      }
   }
   
   _setMaterial(handle, material) {
      if (handle >= 0) {
         super._setMaterial(handle, material);
      } else {
         this._nGon.material.set(-(handle+1), 0, material);
      }
   }
   
   stat() {
      return "Quad Count: " + this.length() + ";\n" +
             "Polygon Count: " +  this._nGon.material.length()  + ";\n";
   }
}






class QuadMesh extends SurfaceMesh {
    constructor(hEdges, vertices, faces, holes, internal) {
      super(hEdges, vertices, faces, holes, ...internal);
   }
   
   static create(materialDepot, size) {
      const params = SurfaceMesh._createInternal(materialDepot);
      const hEdges = QuadEdgeArray.create(size);
      const vertices = VertexArray.create(size);
      const faces = QuadArray.create(params[1].proxy, size);
      const holes = HoleArray.create(size);

      return new QuadMesh(hEdges, vertices, faces, holes, params);
   }
   
   _computeNormal() {
      this.v.computeCCNormal();
   }
   
      
   _allocPolygon(material, side) {
      if (side < 3) {
         throw("bad polygon, less then 3 sides");
      } else if (side === 4) {   // quad
         const handle = this._faces.alloc(material);
         this.h.alloc(handle);
         return handle;
      } else { // nonQuad
         const fHandle = this.f.nGonAlloc(material, side);
         const hHandle = this.h.nGonAlloc(fHandle, side);
         this.f.setHalfEdge(fHandle, hHandle);
         return fHandle;
      }
   }
   
}

export {
   QuadMesh,
}
