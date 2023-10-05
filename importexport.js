//
// file handling. 
// 1) handling local file upload. and simple file download.
// todo
// 2) dropbox, yandex.
// 3) google drive, microsoft onedrive, baidupan to come later.
//
import {HalfEdgeArray} from './surfacemesh.js';
import {QuadMesh} from './quadmesh.js';
import {TriangleMesh} from './trimesh.js';
import {blinnPhongToPBR, defaultPBR} from './material.js';
import * as Mat4 from './mat4.js';
import {vec3a} from './vec3.js';



class Importer {
   constructor(gl, depot, loadAsync, path, options) {
      this._gl = gl;
      this._depot = depot;
      this._loadAsync = loadAsync;
      this._path = path;
      this._library = {texture: new Map, material: new Map};
      this._objs = [];
      this._currentMesh = null;
      this._currentMaterial = null;
      this._vertexMapping = []; // convert index
      this._uvMapping = {};
      this._non_manifold = [];
      this._polygonProcessed = 0;
      this._triangleOnly = options.tri;
      this._zUp = Mat4.identity();
      if (options.zUp) {
         this._zUp = [1, 0,  0, 0,
                      0, 0, -1, 0,
                      0, 1,  0, 0,
                      0, 0,  0, 1];
      }

      // add an initial group
      this.addObject("");
   }
   
   async loadAsync(uri) {
      return this._loadAsync(uri);
   }
   
   addObject(name="") {
      this.flushGroup();
      if (!this._currentMesh || !this._currentMesh.isEmpty()) {
         if (this._triangleOnly) {
            this._currentMesh = TriangleMesh.create(this._depot);
         } else {
            this._currentMesh = QuadMesh.create(this._depot);
         }
         // remember to add uvs dynamic property.
         this._currentUvs = HalfEdgeArray.addUvs(this._currentMesh.h, 1);

         this._objs.push( this._currentMesh );
      }
      //this._currentMesh.name = name;
   }

   addGroup(name="") {
      this.flushGroup();
      // add a new one to current mesh
      this._currentNameGroup = this._currentMesh.addNameGroup(name, this._polygonProcessed);
   }

   flushGroup() {
      if (this._currentNameGroup) {
         this._currentNameGroup.finalize(this._polygonProcessed+1);
      }
      this._currentNameGroup = null;
   }
   
   addFace(faceIndex, uvIndex) {
      const polygon = this._currentMesh.addFace(faceIndex, this._currentMaterial);
      if (!polygon.success) {
         this.non_manifold.push( this._polygonProcessed );    // addup failure.
      } else {
         let mapping = this._uvMapping[0];
         if (mapping && (uvIndex.length > 0) && (uvIndex.length === faceIndex.length)) {
            if (uvIndex.length === polygon.hLoop.length) {
               for (let i = 0; i < uvIndex.length; ++i) {
                  this._currentUvs[0].setUV(polygon.hLoop[i], mapping[uvIndex[i]]);
               }
            } else {
               console.log("uv size different from polygon side");
            }
         }      
      }
      this._polygonProcessed++;
      return polygon;
   }
   
   addVertex(vert) {
      // should we do error check?
      vec3a.transformMat4(vert, this._zUp);
      const vertex = this._currentMesh.addVertex(vert, 0);   // meshlab produced vertex with color. we want to support this tool
      this._vertexMapping.push(vertex);
   }
   
   addTexCoord(uv, channel) {
      if (!this._uvMapping[channel]) { // add array if not existed.
         this._uvMapping[channel] = [];
      }
      this._uvMapping[channel].push( uv );
   }
   
   getVertex(idx) {
      if ( (idx >= 0) && (idx < this._vertexMapping.length)) {
         return this._vertexMapping[idx];
      } else {
         console.log("face index out of bound: " + idx);
         return 0;
      }
   }
   
   getVertexLength() {
      return this._vertexMapping.length;
   }
   
   getTexCoordLength(channel) {
      if (this._uvMapping[channel]) {
         return this._uvMapping[channel].length;
      }
      return 0;
   }
   
   getScene() {
      this.flushGroup();
      for (let obj of this._objs) { // update all 
         obj.doneEdit();
      }
      return {world: this._objs,};// materialCatalog: Array.from(this.materialCatalog.values())};
   }

   /**
    * given an halfEdge (v0, v1), set sharpness value
    * @param {int} v0 
    * @param {int} v1 
    * @param {float} sharpness 
    */
   addSharpness(v0, v1, sharpness) {
      const hEdge = this._currentMesh.findHalfEdge(v0, v1);
      this._currentMesh.h.setSharpness(hEdge, sharpness);
   }


   addMaterial(name, pbr) {
      let mat = this._library.material.get(name);
      if (!mat) {
         mat = this._depot.create(this._gl, name, pbr);
         this._library.material.set(name, mat);
      } else { // otherwise update.
         this._depot.setValues(mat, pbr);
      }
      return mat;
   }

   addMaterialBlinnPhong(name, old) {
      return this.addMaterial(name, blinnPhongToPBR(old)); 
   }

   useMaterial(matname) {
      let mat = this._library.material.get(matname);
      if (!mat) {
         mat = this.addMaterial(matname, defaultPBR());  // create stub for later update
      }
      this._currentMaterial = mat;
      return mat;
   }
   
   addTexture(filename, flipY) {
      let texture = this._library.texture.get(filename);
      if (!texture) {
         //const filename = getFilenameAndExtension(uri).join('.');  // uri
         texture = this._depot.t.create(this._gl, filename, {flipY: flipY});
         this._library.texture.set(filename, texture);
         
         this._loadAsync(filename) 
                        .then(blob=>{
                            const img = document.createElement("img");
                            img.src = URL.createObjectURL(blob);
                            return img;
                        }).then(img=>{
                           img.onload = ()=>{
                              this.setImage(texture, img);
                           }
                           return img;
                        });
      }
      return texture;
   }

   createColor(color) { // [r,g,b] - three 8bit values
      let rgba = (color[0] << 24) + (color[1] << 16) + (color[0] << 8);
      let index = this.reservedColors.get(rgba);
      if (index === undefined) {
         index = HalfEdge.color.reserve();
         HalfEdge.color.setValue(index, color);
         this.reservedColors.set(rgba, index);
      }
      return index;
   }

   createUV(channel, uv) { // uv
      let texCoord = (GL.toHalf(uv[0]) << 16) + GL.toHalf(uv[1]);
      let index = this.reservedUv.get(texCoord);
      if (index === undefined) {  
         index = Attribute.uv.reserve();
         Attribute.uv.setChannel(index, channel, uv);
         this.reservedUv.set(texCoord, index);
      }
      return index;
      //const index = Attribute.uv.reserve();
      //this.texCoords.push(index);
      //Attribute.uv.setChannel(index, 0, texCoord.slice(0,2));
   }
   
   getMaterial(materialName) {
      return this._library.material.get(materialName);
   }
   
   getTexture(textureName) {
      return this._library.texture.get(textureName);
   }
   
   setBaseColorTexture(textureHandle) {
      this._depot.setBaseColorTexture(this._currentMaterial, textureHandle);
   }
   
   setImage(textureHandle, image) {
      this._depot.t.setImage(this._gl, textureHandle, image);
   }

   static decodeText(dataView) {
      // The TextDecoder interface is documented at http://encoding.spec.whatwg.org/#interface-textdecoder
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(dataView);   
   }
   
   static getFilenameAndExtension(pathfilename) {
      const filenameextension = pathfilename.replace(/^.*[\\\/]/, '');
      const index = filenameextension.lastIndexOf('.');
      let ext = "";
      let filename = filenameextension;
      if (index >= 0) {
         filename = filenameextension.substring(0, index);
         ext = filenameextension.substring(index+1, filenameextension.length);
      }
      return [filename, ext];
   }
};


export {
   Importer
};
