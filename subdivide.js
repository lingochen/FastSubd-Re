/**
 * DirectedEdge, Catmull-Clark subdivision, Loop Sudivision, Modified Buttefly Subdivision.
 * 
 */
 
//import {QuadMesh} from './quadmesh.js';
import {TriangleMesh, TriangleEdgeArray} from './surfacemesh.js';
import * as Tri from './subdividetri.js';
import * as Loop from './subdivideloop.js';
// import * as MB from './subidivdemb.js';
import * as Parallel from './workers/subdivideparallel.js';


async function loopSubdivide(subd, source) {
   // setup the source
   const task = Tri.computeWorkTask(source);
   const mDat = Tri.setupSubdivide(subd, source, task, Loop.edgeNewVertex, Loop.vertexRefine);

   // copy/refine vertex and add middle edge points.
   for (let i = 0; i < task.vMix.length; ++i) {
      Tri.vertexTask(mDat, i);
   }
   //refineEdge(subd, source, computeSubdivideMid);
   Tri.vertexTaskRemainder(mDat);
   
   // setup all face's hEdge
   let length = source.f.length();
   for (let i = 0; i < length; ++i) {
      Tri.triTask(mDat, i);
   }
   
   // setup wEdge's halfEdge
   for (let i = 0; i < task.wMix.length; ++i) {
      Tri.wEdgeTask(mDat, i);
   }
   Tri.wEdgeTaskRemainder(mDat);
   
   // update boundaryLoop
   Tri.boundaryLoopTask(mDat);
   
   return subd;  
}




function createNextLevelTriMesh(source) {
   const subd = TriangleMesh.create(source._material.depot);
   subd.v._valenceMax = source.v.valenceMax();
   // remember to add "uvs" dynamic property
   TriangleEdgeArray.addUV(subd.h, 0);
   
   // compute size
   const nVertices = source.v.length() + source.h.lengthW();
   const nHfEdges = source.f.length() * 4 * 3;     // directedEdge mapped to face 3:1
   const nWEdges = source.h.lengthW()*2 + source.f.length()*3;
   const nFaces = source.f.length() * 4;
   const nBoundaries = source.h.lengthH() * 2;
   const nHoles = source.o.length();
   
   // preallocated buffer
   subd.reserve(nVertices, nWEdges, nHfEdges, nBoundaries, nFaces, nHoles);
   
   // preallocated enough points to next subdivision level,
   subd.v._allocArray(nVertices);
   // preallocated next level of the wEdges/Faces.
   subd.h._allocEx(nHfEdges);                   
   subd.h._allocWEdge(nWEdges);
   subd.f._allocArray(nFaces); 
   // preallocated next level of boundaryLoop
   subd.h._allocHEdge(nBoundaries);
   subd.o._allocArray(nHoles);

   return subd;
}



async function triSubdivide(subdivideFn, source, level) {
   let subd = source;

   let text = "";
   let multi = 1;
   for (let i = 0; i < level; ++i) {
      let start = Date.now();

      subd = await subdivideFn(createNextLevelTriMesh(subd), subd);
      // TODO: readjust _material
      //multi *= 4;
      //
      text += "(level: " + (i+1) + ", time: " + (Date.now()-start) + ")\n";
      if (1) {
         const sanity = subd.sanityCheck();
         console.log("mesh integrity: " + sanity);
         console.log(subd.stat());
      }
   }
   // readjust _material
   for (let [mat, count] of source.m) {
      subd.m.addRef(mat, count*multi);
   }
   return [subd, text];
}

async function subdivideCC(source, level) {
   
}

async function subdivideMB(source, level) {
   return triSubdivide(mbSubdivide, source, level);
}

async function subdivideLoop(source, level) {
   if (false) {
      return triSubdivide(loopSubdivide, source, level);
   } else {
      return triSubdivide(Parallel.loopSubdivide, source, level);
   }
}

export {
   subdivideCC,
   subdivideMB,
   subdivideLoop,
}
