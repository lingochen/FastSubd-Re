/**
 * 
 *  loop vertexRefine, newEdgeVertex.
 * 
 */
 
import {vec3, vec3a} from './vec3.js';


/**
 * @param {*} subd 
 * @param {*} source 
 * @param {*} computeSubdivideMid 
 * 
 * (E.1) New creased edge points – the midpoint Q of the old edge if sharpness >=1.0, or <0. 
 * (E.2) New smooth edge points – the weighted average 1/4(3Q + R) when sharpness === 0;
 * (E.3) New blended crease edge points – the linear interpolation of
 *    point rules (E.1) and (E.2) with weight σ ∈ (0, 1),
*/
function edgeNewVertex(mThis, destVert, wEdge) {
   const midEdge = [0, 0, 0];

   const [left, right] = mThis.srch.wEdgePair(wEdge);
   const leftV = mThis.srch.origin(left);
   const rightV = mThis.srch.origin(right);
   let valence = 6;                    // no boundary, valence === 6
   // get sharpness
   let sharpness = mThis.srch.wSharpness(wEdge);
   if ((sharpness < 0) || (sharpness >= 1)) {   // e1
      if (sharpness >= 1) {
         sharpness -= 1;
      } else {
         valence = 4;                  // boundary, valence == 4
      }
      // e1, crease mid-edge.
      vec3.scale(midEdge, 0, mThis.srcvp, leftV*4, 0.5);
      vec3a.scaleAndAdd(midEdge, 0, mThis.srcvp, rightV*4, 0.5);
   } else { // e2, or e3
      let q = 3/8, r = 1/8;   // e2
      if (sharpness !== 0) {  // blend, e3
         let u = 1.0 - sharpness;
         q = q*u + (0.5*sharpness);
         r = r*u;
      }
      sharpness = 0;          // between (0,1) - after subdivide, goes to 0
      // compute smooth, blend mid-Edge
      const leftV1 = mThis.srch.origin( mThis.srch.prev(left) );
      const rightV1 = mThis.srch.origin( mThis.srch.prev(right) );
         
      vec3.scale(midEdge, 0, mThis.srcvp, leftV*4, q);
      vec3a.scaleAndAdd(midEdge, 0, mThis.srcvp, rightV*4, q);
      vec3a.scaleAndAdd(midEdge, 0, mThis.srcvp, leftV1*4, r);
      vec3a.scaleAndAdd(midEdge, 0, mThis.srcvp, rightV1*4, r);
   }
   
   
   // copy over, midEdge, setHalfEdge, set crease here?
   vec3.copy(mThis.destvp, destVert * 4, midEdge, 0);
   mThis.destv.setValence(destVert, valence);
    
   //return sharpness;
   return left;

/*         // copy over new sharpness
         destH.setwSharpness(wEdge*2, sharpness);
         destH.setwSharpness(wEdge*2+1, sharpness);
         // and setup outEdge pointer
         destV.setHalfEdge(offset+wEdge, computeSubdivideMid(left));
         destV.setValence(offset+wEdge, valence);
         destV.setCrease(offset+wEdge, sharpness);
*/
};



/**
 * 
 * @param {*} subd 
 * @param {*} source 
 * @param {*} computeSubdividehEdge 
 * (V.1) New corner vertex points – the old vertex point V ,
 * (V.2) New crease vertex points – the weighted average (3/4V + 1/8(a+b)) === 1/4(3V + S),
 * (V.3) New smooth vertex points – the average (1 − nβn )V + βn n · T ,
 * (v.4) New blended vertex points – the linear interpolation of point rules (V.2) and (V.3) with weight σ̄ ∈ (0, 1),
*/
function vertexRefine(mThis, destVertex, vertex) {
   const pt = [0, 0, 0, 0];

   const valence = mThis.srcv.valence(vertex);
   let crease = mThis.srcv.crease(vertex);
   if (crease < 0) {             // corner, don't change
      vec3.copy(mThis.destvp, destVertex*4, mThis.srcvp, vertex*4);
   } else if (crease >= 1) {     // crease
      vec3.scale(pt, 0, mThis.srcvp, vertex*4, 3/4);
      for (let inEdge of mThis.srcv.inHalfEdgeAround(vertex)) {
         if (mThis.srch.sharpness(inEdge) !== 0) {
            const out = mThis.srch.origin(inEdge);
            vec3a.scaleAndAdd(pt, 0, mThis.srcvp, out*4, 1/8);
         }
      }
      vec3.copy(mThis.destvp, destVertex*4, pt, 0);
      crease -= 1;
   } else { // compute push down
      let beta = 3/16;
      const k = valence;
      if (k > 3) {
         beta = 3 / (8*k);
      }
      // smooth or blend
      if (crease === 0) {        // smooth
         vec3.scale(pt, 0, mThis.srcvp, vertex*4, 1 - k*beta);
         for (let inEdge of mThis.srcv.inHalfEdgeAround(vertex)) {
            const out = mThis.srch.origin(inEdge);
            vec3a.scaleAndAdd(pt, 0, mThis.srcvp, out*4, beta);
         }
      } else { // (0,1) blend between smooth and crease
         const smooth = 1 - crease;
         vec3.scale(pt, 0, mThis.srcvp, vertex*4, smooth*(1 - k*beta) + crease*(3/4));
         for (let inEdge of mThis.srcv.inHalfEdgeAround(vertex)) {
            const out = srchEdges.origin(inEdge);
            if (srchEdges.sharpness(inEdge) !== 0) {
               vec3a.scaleAndAdd(pt, 0, mThis.srcvp, out*4, beta * smooth + 1/8 * crease);
            } else {
               vec3a.scaleAndAdd(pt, 0, mThis.srcvp, out*4, beta * smooth);
            }
         }
      }
      vec3.copy(mThis.destvp, destVertex*4, pt, 0);
      crease = 0;
   }
   
   // setHalfEdge and valence, and crease
   mThis.destv.setValence(destVertex, valence);
   
   return mThis.srcv.halfEdge(vertex);
      
      //const hEdge = srcV.halfEdge(vertex);
      //subd.v.setHalfEdge(vertex, computeSubdividehEdge(hEdge));
      //subd.v.setValence(vertex, valence);         // valence of the original vertex don't change
      //subd.v.setCrease(vertex, crease);
};


export {
   edgeNewVertex,
   vertexRefine,
}

