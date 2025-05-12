/**
 * Only triangle mesh here, general polygon is better handle by traditional HalfEdge. (2024/08/14)
 * Now handle general polygon. Use triangles to fill the polygon. (2025/03/03)
 * 
 * Provided 7 classes.

 * TriangleArray => FaceArray
 * HoleArray
 * TriangleMesh => SurfaceMesh
 * 
 * Note: Gino van den Bergen has an interesting implementation. http://www.dtecta.com/files/GDC17_VanDenBergen_Gino_Brep_Triangle_Meshes.pdf
 */

import {Int32PixelArray, allocBuffer, PixelArrayGroup, ExtensiblePixelArrayGroup} from './pixelarray.js';
//import {vec3, vec3a} from "./vec3.js";
import {VertexArray} from "./vertex.js";
import {WholeEdgeArray} from "./halfedge.js";



class FaceArray extends ExtensiblePixelArrayGroup {
   constructor(array, prop, fmm) {
      super(prop, fmm);
      this._material = array?.material;
      this._hfEdge = array.hfEdge;
      this._numberOfSide = array.numberOfSide;
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

   static create(size) {
      const array = {
         material: Int32PixelArray.create(1, 1, size),
         hfEdge: Int32PixelArray.create(1, 1, size),
         numberOfSide: Int32PixelArray.create(1, 1, size),
      };
      const fmm = {};
      
      return new FaceArray(array, {}, fmm);
   }
      
   alloc(material) {
      const face = this.allocArray(1)[0];
      this.setMaterial(face, material);
      return face;
   }
   
   free(handle) {
      throw("not implemented");
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
   
   material(polygon) {
      return this._material.get(polygon, 0);
   }
   
   setMaterial(polygon, material) {
      this._material.set(polygon, 0, material);
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
   }33

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
   constructor(hEdges, vertices, faces, holes, bin) {
      this._bin = bin;
      this._hEdges = hEdges;
      this._vertices = vertices;
      this._faces = faces;
      this._holes = holes;
   }

   static create(size) {
      const dEdges = WholeEdgeArray.create(size);
      const vertices = VertexArray.create(size);
      const faces = FaceArray.create(size);
      const holes = HoleArray.create(size);
      const bin = {nameGroup:[],};

      return new TriangleMesh(dEdges, vertices, faces, holes, bin);
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
   
   stepAround() {
      return this._hEdges._stepAround;
   }
   
   /**
    * circle around vertex, return inEdge(point toward vertex).
    * 
    */
   * inHalfEdgeAroundVertex(vert, stepAround=this._hEdges._stepHopAround) {
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
   * outHalfEdgeAroundVertex(vert, stepAround=this._hEdges._stepAroundOver) {
      if (this._vertices.hasHalfEdge(vert)) {
         const outEdge = this._vertices.halfEdge(vert);
         yield* this._hEdges.circulator(outEdge, outEdge, stepAround);
      }
   }
   
   /**
    * simple wrapper around FaceArray.halfEdgeLoop 
    */ 
   halfEdgeAroundFace(face) {
      //const hfEdge = 
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
   
   static addUV(mesh, index=0) {
      return WholeEdgeArray.addUV(mesh.h, index);
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
//   FaceArray,
//   HoleArray,
   TriangleMesh,
}
