/**
 * setting up the canvas for rendering
 * 
 */

import {Importer} from './importexport.js';
import {importObj} from './wavefront_obj.js';
import {MaterialDepot} from './material.js';
import * as m4 from './mat4.js';
import {vec3a} from './vec3.js';
import * as glUtil from './glutil.js';


const multiQuadVS = `#version 300 es
precision highp float;

in vec4 a_position;
in vec4 a_normal;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_world;

//uniform sampler2D u_attribute;

void main() {
   int idx = gl_VertexID;
   int face = gl_InstanceID;
}
`;


const pullVS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in ivec3 a_pullVertex;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_world;

//uniform int u_currentMat;

uniform sampler2D u_position;
uniform sampler2D u_normal;

uniform sampler2DArray u_uvs;

out vec3 v_normal;
out vec2 v_texcoord;

ivec2 getPull(int texWidth, int index) {
   int col = index % texWidth;
   int row = index / texWidth;
   return ivec2(col, row);
}



void main() {
   int texWidth = textureSize(u_position, 0).x;
   vec3 temp = texelFetch(u_position, getPull(texWidth, a_pullVertex.y), 0).xyz;
   vec4 a_position = vec4(temp, 1);
   vec3 a_normal = texelFetch(u_normal, getPull(texWidth, a_pullVertex.y), 0).xyz;

   gl_Position = u_projection * u_view * u_world * a_position;

   v_normal = mat3(u_world) * a_normal;
   
   v_texcoord = texelFetch(u_uvs, ivec3(getPull(texWidth, a_pullVertex.x), 0), 0).xy;
}


`;

const pullFS = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_texcoord;

uniform sampler2D u_baseColorTexture;

uniform vec4 u_diffuse;
uniform vec3 u_lightDirection;

out vec4 outColor;

void main () {
  
  outColor = texture(u_baseColorTexture, v_texcoord);  

  vec3 normal = normalize(v_normal);
  float fakeLight = dot(u_lightDirection, normal) * .5 + .5;
  outColor = vec4(u_diffuse.rgb * fakeLight, u_diffuse.a) * outColor;

}
`;


let info = {
   gl: null,
   meshProgram: null,
   buffer: null,
   drawBuffer: null,
   depot: null,
};
/*
   gl - 

*/
function initMain(gl) {

   info.gl = gl;
   // compiles and links the shaders
   info.meshProgram = glUtil.createProgram(gl, pullVS, pullFS);
   
   // create MaterialDepot.
   info.depot = new MaterialDepot(gl);
   
   info.buffer = gl.createBuffer();
 
 
}

 
const cameraDefault = {
   fov: 60,
   target: [0, 0, 0],
   position: [0, 2, 8],
   zNear: 0.1,
   zFar: 80,
}
const cameraData = {
   fov: 60,
   target: [0, 0, 0],
   position: [0, 2, 8],
   zNear: 0.1,
   zFar: 80,
}; 
const renderData = {
   materials: null,
   position: null,
   attribute: null,
   uvs: null,
};

let renderOn = false;
function setRenderData(source) {
   const data = source.makePullBuffer(info.gl);
   info.drawBuffer = glUtil.updatePullBufferInfo(info.gl, info.buffer, data.pullVertex);

   // data
   renderData.materials = data.materials;
   renderData.position = data.position;
   renderData.attribute = data.attribute;
   renderData.uvs = data.uvs;
   if (!renderOn) {
      renderOn = true;
      requestAnimationFrame(render);
   }   
}


function setCamera(camera) {
   // camera
   Object.assign(cameraData, cameraDefault);
   Object.assign(cameraData, camera);

}
 
 
function render(time) {
     time *= 0.0004;  // convert to seconds
 
     glUtil.resizeCanvasToDisplaySize(info.gl.canvas);
     info.gl.viewport(0, 0, info.gl.canvas.width, info.gl.canvas.height);
     info.gl.enable(info.gl.DEPTH_TEST);
     info.gl.enable(info.gl.CULL_FACE);
 
     const aspect = info.gl.canvas.clientWidth / info.gl.canvas.clientHeight;
     const projection = m4.perspective(cameraData.fov, 
                                       aspect, 
                                       cameraData.zNear, 
                                       cameraData.zFar);
 
     const up = [0, 1, 0];
     // Compute the camera's matrix using look at.
     const camera = m4.lookAt(cameraData.position, cameraData.target, up);
 
     // Make a view matrix from the camera matrix.
     const view = m4.inverse(camera);
 
     const sharedUniforms = {
       u_lightDirection: {type: "vec3", value: vec3a.normalize([-1, 3, 5], 0)},
       u_view: {type: "mat4", value: view},
       u_projection: {type: "mat4", value: projection},
       u_position: renderData.position,
       //u_attribute: renderData.attribute,
       u_uvs: renderData.uvs,
     };
 
     info.gl.useProgram(info.meshProgram.program);
 
     // calls gl.uniform
     glUtil.setUniforms(info.gl, info.meshProgram, sharedUniforms);
 
     // set the attributes for this part.
     //gl.bindVertexArray(vao);
 
     // calls gl.uniform
     glUtil.setUniforms(info.gl, info.meshProgram, {
       u_world: {type: "mat4", value: m4.rotationY(time)},
       u_diffuse: {type: "vec4", value: [1, 0.7, 0.5, 1]},
     });
 
      for (let material of renderData.materials) {
         // setup baseColorTexture
         let current = material();
         glUtil.setUniforms(info.gl, info.meshProgram, current);
      
         // calls gl.drawArrays or gl.drawElements
         glUtil.drawPullBuffer(info.gl, info.meshProgram, info.drawBuffer);
      }
 
     requestAnimationFrame(render);
}


const modelRead = new Map;
async function readFile(ccmUrl, options, camera) {
   if (modelRead.has(ccmUrl)) {
      const source = modelRead.get(ccmUrl);
      setRenderData(source);
      setCamera(camera);
      return source;
   }

   const path = ccmUrl.substring(0, ccmUrl.lastIndexOf("/"));
   async function loadAsync(localUrl) {
      if (path) {
         localUrl = path + "/" + localUrl;
      }
      return await (await fetch(localUrl)).blob(); 
   }

   const blob = await (await fetch(ccmUrl)).blob(); 
   return importObj([blob], new Importer(info.gl, info.depot, loadAsync, path, options)).then(scene=>{
      /*for (let mesh of scene.world) {
         console.log("mesh integrity check: " + mesh.sanityCheck());
         console.log(mesh.stat());
      }*/
      let source = scene.world[0];
      modelRead.set(ccmUrl, source);               // save for later reuse
      source.sanityCheck();
      setRenderData(source);
      setCamera(camera);
      return source;
  });
};
 
 export {
    initMain,
    readFile,
    setRenderData,
 }
