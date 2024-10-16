/*
 * provide common operations for loop, modified butterfly. 
 * 
 * setup, tasks
 * 
 * hEdge, wEdge reconnect.
 * 
 */
import {vec2, vec2a} from './vec2.js';
//import {vec3, vec3a} from './vec3.js';
 
 

function setupSubdivide(dest, source, task, edgeVertex, refineVertex) {
   const mDat = {};
   mDat.vMix = task.vMix;
   mDat.wMix = task.wMix;
   mDat.src = source;
   mDat.srcv = source.v;
   mDat.srcvp = source.v.positionBuffer();
   mDat.srch = source.h;
   mDat.srchwe = source.h.w;
   mDat.srcf = source.f;
   mDat.srco = source.o;
   mDat.dest = dest;
   mDat.destv = dest.v;
   mDat.destvp = dest.v.positionBuffer();
   mDat.desth = dest.h;
   mDat.destwe = dest.h.w;
   mDat.desthv = dest.h.vBuffer();
   mDat.desthw = dest.h.wBuffer();
   mDat.desthwe = dest.h.wEdgeBuffer();
   mDat.destf = dest.f;
   mDat.desto = dest.o;
   mDat.edgeNewVertex = edgeVertex;
   mDat.vertexRefine = refineVertex;
   
   return mDat;
}
function computeWorkTask(src) {
//
// just go [e,e,e to end] then [v,v,v....], don't try to mixed it,
//
   const vMix={}, wMix={};

   let j = src.v.length();
   let k = src.h.w.length() / 3;
   
   if (j < k) {      // limit by vertex, more wEdge for mix, not likely though
      vMix.wLength = j * 3;
      vMix.vLength = j;
   } else {          // more/equal vertex
      vMix.vLength = Math.trunc(k);
      vMix.wLength = vMix.vLength * 3;
   }
   vMix.length = vMix.vLength;
   
   // wEdge face Mix to wEdge
   j = src.f.length() / 2;
   k = src.h.w.length() / 3;
   if (j < k) {      // limit by face, more wEdge > face for mix, not likely though
      wMix.length = Math.trunc(j);
   } else {          // limit by wEdge;
      wMix.length = Math.trunc(k);
   }
   wMix.wLength = wMix.length * 3;
   wMix.fLength = wMix.length * 2;
   return {vMix, wMix};  // clone object
}


function vertexTask(mThis, i) {
   let destV = i * 4;
   let wEdge = i * 3;
   vertexRefine(mThis, destV++, i);
   edgeNewVertex(mThis, destV++, wEdge++);
   edgeNewVertex(mThis, destV++, wEdge++);
   edgeNewVertex(mThis, destV, wEdge);
}
function vertexTaskRemainder(mThis) {
   let destV = mThis.vMix.length * 4;
   
   // wEdge remainder
   let length = mThis.srchwe.length();
   for (let i = mThis.vMix.wLength; i < length; ++i) {
      edgeNewVertex(mThis, destV++, i);
   }
   
   // vertex remainder
   length = mThis.srcv.length();
   for (let i = mThis.vMix.vLength; i < length; ++i) {
      vertexRefine(mThis, destV++, i);
   }
}

   
function edgeNewVertex(mThis, destVertex, vertex) {
   const dEdge = mThis.edgeNewVertex(mThis, destVertex, vertex);
   
   const rem = dEdge % 3;
   //const hEdge = Math.trunc(dEdge / 3)*3*4 + (dEdge % 3)*3 + 1;
   const hEdge = (dEdge - rem)*4 + rem*3 + 1;
   mThis.destv.setHalfEdge(destVertex, hEdge);
}
function vertexRefine(mThis, destVertex, vertex) {
   const dEdge = mThis.vertexRefine(mThis, destVertex, vertex);

   const rem = dEdge % 3;
   //const hEdge = Math.trunc(dEdge / 3)*3*4 + (dEdge % 3)*3;    // new dEdge position
   const hEdge = (dEdge - rem)*4 + rem*3;
   mThis.destv.setHalfEdge(destVertex, hEdge);
}
   

function computeNewVertex(mThis, oldVertex) {
   const diff = oldVertex - mThis.vMix.vLength;
   if (diff < 0) {
      return oldVertex * 4;
   } else { // wEdge goes first
      const lengthW = mThis.srchwe.length();
      const offset = 4 * mThis.vMix.length + (lengthW - mThis.vMix.wLength);
      return offset+diff;
   }
}
function computeEdgeVertex(mThis, wEdge) {
   let diff = wEdge - mThis.vMix.wLength;
   if (diff < 0) {      
      const idx = wEdge % 3;
      const edgeVertex = Math.trunc(wEdge/3)*4;
      return edgeVertex + 1 + idx;                 // vertex will take the 1st location.
   } else { 
      return 4 * mThis.vMix.length + diff;
   }
}
//
// return [loWhandle, hiWhandle, newVertex]
function computeNewWEdge(mThis, wHandle) { //oldhEdge) {
   //const wHandle = mThis.srch._wEdge(oldhEdge);
   const isRight = wHandle & 1;           // % 2
   //const oldWEdge = Math.trunc(wHandle / 2);
   const oldWEdge = wHandle >> 1;
   
   const diff = oldWEdge - mThis.wMix.wLength;
   let newWEdge, loHi;
   if (diff < 0) {
      loHi = [[0, 4], [5, 1]];      // wedge's right 2*2
      const idx = oldWEdge % 3;
      //newWEdge = ((Math.trunc(oldWEdge/3) * 12) + idx * 4) * 2;
      newWEdge = (((oldWEdge-idx)*4) + idx * 4) * 2;
   } else { // over the wMix
      loHi = [[0, 2], [3, 1]];
      // compute extra faceW first,
      const offset = 3 * (mThis.srcf.length() - mThis.wMix.fLength);
      newWEdge = (12* mThis.wMix.length + offset + 2*diff) * 2;        // 2*is [lo, hi]
   }
   loHi = loHi[isRight];
   return  [newWEdge + loHi[0], newWEdge + loHi[1], computeEdgeVertex(mThis, oldWEdge)];
}
function computeNewFaceWEdgeIndex(mThis, oldFace) {
   const diff = oldFace - mThis.wMix.fLength;
   if (diff < 0) {
      const idx = oldFace & 1;         // == %2
      //const newFaceWEdge = Math.trunc(oldFace/2) * 12;
      const newFaceWEdge = (oldFace >> 1) * 12;
      const faceW = (newFaceWEdge + 1 + 6*idx) * 2;
      return [faceW, faceW+4, faceW+8,];
   } else { // 
      let faceW = (12 * mThis.wMix.length + (diff*3)) * 2;
      return [faceW, faceW+2, faceW+4];
   }
}


//
// walk over hole's halfEdge and expand everything by 2
// expecting compactBuffer only. Won't work otherwise.
// every hole's halfEdge is up by 2.
//
function boundaryLoopTask(mThis) {
   // update dest hole's halfEdge
   let length = mThis.srco.length();
   for (let hole = 0; hole <= length; ++hole) {
      let hEdge = mThis.srco.halfEdge(hole);
      hEdge = -(hEdge+1);                 // get real positive index
      mThis.desto.setHalfEdge(hole, -(hEdge*2+1));
      // now update boundaryLoop
      let last = mThis.srch._bArray._prev.get(hEdge, 0);
      last = -(last+1);
      let prev = last*2 + 1;
      for (let j = hEdge; j <= last; j++) {
         let i = j*2;
         mThis.desth._bArray._prev.set(i, 0, -(prev+1));
         mThis.desth._bArray._next.set(i, 0, -(i+2));
         mThis.desth._bArray._hole.set(i, 0, hole);
         // compute, lo, hi, newVertex 
         const edgeW = computeNewWEdge(mThis, mThis.srch._bArray._wEdge.get(j, 0));
         mThis.desth._bArray._wEdge.set(i, 0, edgeW[0]);
         let vertex = computeNewVertex(mThis, mThis.srch._bArray._vertex.get(j, 0));
         mThis.desth._bArray._vertex.set(i, 0, vertex);
         //mThis.dest._hArray.uvs
         // the expand hi,
         mThis.desth._bArray._prev.set(i+1, 0, -(i+1));
         mThis.desth._bArray._next.set(i+1, 0, -(i+3));
         mThis.desth._bArray._hole.set(i+1, 0, hole);        
         mThis.desth._bArray._wEdge.set(i+1, 0, edgeW[1]);
         mThis.desth._bArray._vertex.set(i+1, 0, edgeW[2]);
         prev = i+1;
      }
      // fixeup the last's next
      mThis.desth._bArray._next.set(last*2+1, 0, -(hEdge*2+1));
   }
}

//
// update face's material
// update halfEdgeArray's vertex, pair, wEdge. (how about uvs?)
//
function triTask(mThis, face) {
   // update material? here, or combine together
   
   // 1 face grow to 4 face, each face has 3 hEdge
   let srcHEdge = face * 3;         // get hEdge idx
   let destHEdge = srcHEdge * 4;    // dest expand by 4.
   const destHEdgeBase = destHEdge;
   
   // compute edges uvs(attribute) to be reused
   //const uvs = [[0, 0], [0, 0], [0,0], [0,0], [0,0], [0,0],];
   //_src.h.getUV(srcHEdge, 0, uvs[0]);
   //_src.h.getUV(srcHEdge+1, 0, uvs[1]);
   //_src.h.getUV(srcHEdge+2, 0, uvs[2]);
   //vec2.addAndScale(uvs[3], 0, uvs[0], 0, uvs[1], 0, 0.5);
   //vec2.addAndScale(uvs[4], 0, uvs[1], 0, uvs[2], 0, 0.5);
   //vec2.addAndScale(uvs[5], 0, uvs[2], 0, uvs[0], 0, 0.5);
   
   // new WEdge, pair, new Vertex position computation
   const faceW = computeNewFaceWEdgeIndex(mThis, face);
   const edgeW = [computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge, 0)),
                  computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge+1, 0)),
                  computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge+2, 0)),];
   const index = [[0,2], [1,0], [2,1]];
   for (let [i, prev] of index) {
      let vertex = computeNewVertex(mThis, mThis.srch.origin(srcHEdge+i) );
      // original 0th lower side
      //_dest.h.setUV(destHEdge, 0, uvs[i]);    
      mThis.desthv[destHEdge] = vertex;
      mThis.desthw[destHEdge++] = edgeW[i][0];
      //_dest.h.setOrigin(destHEdge, vertex);                 // original vertex, move to new position.
      //_dest.h._setHEdgeWEdge(destHEdge++, edgeW[i][0]);     // original wEdge, same left(right)? lower side.
      
      // middle new edge
      //_dest.h.setUV(destHEdge, 0, uvs[3+i]);
      mThis.desthv[destHEdge] = edgeW[i][2];
      mThis.desthw[destHEdge++] = faceW[i];
      //_dest.h.setOrigin(destHEdge, edgeW[i][2]);            // newly form edge point
      //_dest.h._setHEdgeWEdge(destHEdge++, faceW[i])         // newly form wEdge from face, leftSide

      // original 2nd hEdge upper side
      //_dest.h.setUV(destHEdge, 0, uvs[3+prev]);
      mThis.desthv[destHEdge] = edgeW[prev][2];
      mThis.desthw[destHEdge++] = edgeW[prev][1];
      //_dest.h.setOrigin(destHEdge, edgeW[prev][2]);         // newly form using "prev" edge point
      //_dest.h._setHEdgeWEdge(destHEdge++, edgeW[prev][1]);  // original wEdge, left(right)? upper side
   }
   // final inner triangle.
   for (let [i, prev] of index) {
      //_dest.h.setUV(destHEdge, 0, uvs[3+prev]);
      mThis.desthv[destHEdge] = edgeW[prev][2];
      mThis.desthw[destHEdge++] = faceW[i]+1;
      //_dest.h.setOrigin(destHEdge, edgeW[prev][2]);        // prev 
      //_dest.h._setHEdgeWEdge(destHEdge++, faceW[i]+1);      // right side
   }
}

function triTaskW(mThis, face) {
   // 1 face grow to 4 face, each face has 3 hEdge
   let srcHEdge = face * 3;         // get hEdge idx
   let destHEdge = srcHEdge * 4;    // dest expand by 4.
   
   // new WEdge, pair, new Vertex position computation
   const faceW = computeNewFaceWEdgeIndex(mThis, face);
   const edgeW = [computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge, 0)),
                  computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge+1, 0)),
                  computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge+2, 0)),];
   const index = [[0,2], [1,0], [2,1]];
   for (let [i, prev] of index) {
      mThis.desthw[destHEdge++] = edgeW[i][0];
      
      // middle new edge
      mThis.desthw[destHEdge++] = faceW[i];

      // original 2nd hEdge upper side
      mThis.desthw[destHEdge++] = edgeW[prev][1];
   }
   // final inner triangle.
   for (let [i, prev] of index) {
      mThis.desthw[destHEdge++] = faceW[i]+1;
   }   
   
}

function triTaskV(mThis, face) {
   // 1 face grow to 4 face, each face has 3 hEdge
   let srcHEdge = face * 3;         // get hEdge idx
   let destHEdge = srcHEdge * 4;    // dest expand by 4.
   
   // new WEdge, pair, new Vertex position computation
   const edgeW = [computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge, 0)),
                  computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge+1, 0)),
                  computeNewWEdge(mThis, mThis.srch._wEdge.get(srcHEdge+2, 0)),];

   const index = [[0,2], [1,0], [2,1]];
   for (let [i, prev] of index) {
      let vertex = computeNewVertex(mThis, mThis.srch.origin(srcHEdge+i) );
      mThis.desthv[destHEdge++] = vertex;
      
      // middle new edge
      mThis.desthv[destHEdge++] = edgeW[i][2];

      // original 2nd hEdge upper side
      mThis.desthv[destHEdge++] = edgeW[prev][2];
   }
   // final inner triangle.
   for (let [i, prev] of index) {
      mThis.desthv[destHEdge++] = edgeW[prev][2];

   }   
   
}


function computeSubdivideFaceDEdge(face) {
   const base = face * 12;
   return [ [base+1, base+9],
            [base+4, base+10],
            [base+7, base+11]];
}
const kNext3 = [1*3, 2*3, 0*3];
function computeSubdivideDEdge(dEdge) {
   if (dEdge >= 0) {
      //const base = Math.trunc(dEdge / 3) *  12;    // compute subdivide face base dEdge
      //const idxLo = (dEdge % 3) * 3;
      //const idxHi = ((dEdge+1) % 3) * 3 + 2;
      const rem = dEdge % 3;
      const base = (dEdge-rem)*4;
      const idxLo = rem * 3;
      const idxHi = kNext3[rem] + 2;
      return [base+idxLo, base+idxHi];
   } else { // 
      dEdge = -(dEdge+1);
      dEdge *= 2;
      return [-(dEdge+1), -(dEdge+2)];
   }
}
function computeSubdivideWEdge(mThis, wEdge) {
   let [left, right] = mThis.srchwe.whole(wEdge);
   let leftD = computeSubdivideDEdge(left);
   let rightD = computeSubdivideDEdge(right);
   return [leftD, rightD];
}
/**
 * subdivide 3 wEdge and adds 2 Face wEdge.
 * one old wEdge to 2 wEdge, every face add 3 wEdge.
 * wEdge to face ratio is approximate 3/2(1.5)
 * so we want to layout the data like [0wEdge, 0face, 1wEdge, 1face, 2wEdge].
 * it expands to [0wedge0, 0wedge1, 0face0, 0face1, 0face2, 1wEdge0, 1wEdge1, 1face0, 1face1, 1face2, 2wEdge0, 2wEdge1]
 * () better cached coherence?
 */
function wEdgeTask(mThis, i) {
   let wEdge = i * 3;
   let wFace = i * 2;
   i *= 12*2;                  // destination wEdge expand by 2. (left, right) is 2 struct
   
   // 0Wedge
   let loHi = computeSubdivideWEdge(mThis, wEdge++);
   mThis.desthwe[i++] = loHi[0][0];
   mThis.desthwe[i++] = loHi[1][1];
   //mThis.desth._setWEdge(i++, loHi[0][0], loHi[1][1]);
   // 0face
   const faceW = computeSubdivideFaceDEdge(wFace);
   mThis.desthwe[i++] = faceW[0][0];
   mThis.desthwe[i++] = faceW[0][1];
   //mThis.desth._setWEdge(i++, faceW[0][0], faceW[0][1]);
   mThis.desthwe[i++] = loHi[0][1];
   mThis.desthwe[i++] = loHi[1][0];
   //mThis.desth._setWEdge(i++, loHi[0][1], loHi[1][0]);
   mThis.desthwe[i++] = faceW[1][0];
   mThis.desthwe[i++] = faceW[1][1];
   //mThis.desth._setWEdge(i++, faceW[1][0], faceW[1][1]);
   // 1Wedge
   loHi = computeSubdivideWEdge(mThis, wEdge++);
   mThis.desthwe[i++] = loHi[0][0];
   mThis.desthwe[i++] = loHi[1][1];
   //mThis.desth._setWEdge(i++, loHi[0][0], loHi[1][1]);
   mThis.desthwe[i++] = faceW[2][0];
   mThis.desthwe[i++] = faceW[2][1];
   //mThis.desth._setWEdge(i++, faceW[2][0], faceW[2][1]);
   mThis.desthwe[i++] = loHi[0][1];
   mThis.desthwe[i++] = loHi[1][0];
   //mThis.desth._setWEdge(i++, loHi[0][1], loHi[1][0]);
   // 1face
   //faceW = computeSubdivideFaceDEdge(wFace+1);
   mThis.desthwe[i++] = faceW[0][0]+12;
   mThis.desthwe[i++] = faceW[0][1]+12;
   //mThis.desth._setWEdge(i++, faceW[0][0]+12, faceW[0][1]+12);
   // 2wEdge
   loHi = computeSubdivideWEdge(mThis, wEdge);
   mThis.desthwe[i++] = loHi[0][0];
   mThis.desthwe[i++] = loHi[1][1];
   //mThis.desth._setWEdge(i++, loHi[0][0], loHi[1][1]);
   mThis.desthwe[i++] = faceW[1][0]+12;
   mThis.desthwe[i++] = faceW[1][1]+12;
   //mThis.desth._setWEdge(i++, faceW[1][0]+12, faceW[1][1]+12);
   mThis.desthwe[i++] = loHi[0][1];
   mThis.desthwe[i++] = loHi[1][0];
   //mThis.desth._setWEdge(i++, loHi[0][1], loHi[1][0]);
   mThis.desthwe[i++] = faceW[2][0]+12;
   mThis.desthwe[i++] = faceW[2][1]+12;
   //mThis.desth._setWEdge(i++, faceW[2][0]+12, faceW[2][1]+12);
}
//
// from incomplete (i) to end of wEdge/face, real end.
function wEdgeTaskRemainder(mThis) {
   // from iEnd to mixEnd, it the same, first [wFace, @wFace....]
   let destW = mThis.wMix.length * 12;
   let length = mThis.srcf.length();     // end of face
   for (let j = mThis.wMix.fLength; j < length; ++j) {
      const faceW = computeSubdivideFaceDEdge(j);
      mThis.destwe.setWhole(destW++, faceW[0][0], faceW[0][1]);
      mThis.destwe.setWhole(destW++, faceW[1][0], faceW[1][1]);
      mThis.destwe.setWhole(destW++, faceW[2][0], faceW[2][1]);     
   }
   
   // then consecutive wEdge until end
   length = mThis.srchwe.length();
   for (let j = mThis.wMix.wLength; j < length; ++j) {
      const loHi = computeSubdivideWEdge(mThis, j);
      mThis.destwe.setWhole(destW++, loHi[0][0], loHi[1][1]);
      mThis.destwe.setWhole(destW++, loHi[0][1], loHi[1][0]);
   }
}



export {
   setupSubdivide,
   computeWorkTask,
   vertexTask,
   vertexTaskRemainder,
   boundaryLoopTask,
   triTask,
   triTaskV,
   triTaskW,
   wEdgeTask,              // actually, 12 wEdge per task (3wEdges, 2Faces)
   wEdgeTaskRemainder,
}
