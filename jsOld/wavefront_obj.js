//
// Wavefront Obj Loader and Writer.
//
//
//import {Importer} from "./importexport.js";


class WavefrontObjImporter {
   constructor(importer) {
      this._maker = importer;
   }
   
   static name() {
      return "Wavefront";
   }

   static extension() {
      return "obj";
   }

   static fileTypes() {
      return ['obj'];
   }

   async import(file) {
      const objText = await file.text();
      // break the objText to lines we needs.
      const linesMatch = objText.match(/^([vfogst]|vt|usemtl|mtllib)(?:\s+(.+))$/gm);   //objText.match(/^v((?:\s+)[\d|\.|\+|\-|e|E]+){3}$/gm);

      if (linesMatch) {
         for (let line of linesMatch) {
            let split = line.match(/\S+/g); // === line.trim().split(/\s+/); Note: line.split(' ') sometime generate spurious empty data.
            let tag = split.shift();
            if (typeof this[tag] === 'function') {
               this[tag](split);
            } else {
               console.log("unexpected tag: " + tag); // should not happened
            }
         }
         //this._readAuxFiles();
         // done reading, return the object.
      }
      return this._maker.getScene();
   }

   o(objName) {
      this._maker.addObject(objName);
   }

   /**
    * how do we handle group? what is a group? needs to find out.
    * @param {*} groupNames - do nothing for now.
    */
   g(groupName) {
      if (groupName && (groupName !== "(null)")) { // group is like object, except for empty and (null)
         this._maker.addGroup(groupName);
      }
   }

   s(groupNumber) {  // smooth group. probably not applicable ?
      // to be implemented later
   }

   /**
    * opensubdiv crease support
    * @param {array} params - check if the array conform to opensubdiv's 
    */
    t(params) {
      if (params[0] === "crease") {
         // vertex is 1 based, convert to 0 based.
         this._maker.addSharpness(this._maker.getVertex(params[2]), this._maker.getVertex(params[3]), Number(params[4]));
      }
   }

   v(vertex) {
      vertex = vertex.map(Number);
      this._maker.addVertex(vertex);
   }

   vt(texCoord) {
      texCoord = texCoord.map(Number);
      this._maker.addTexCoord(texCoord, 0);
   }

   /**
    * 
    * @param {*} index - an array of id such as [idx0, idx1, idx2].
    */
   f(index) {
      const faceIndex = [];
      const uvIndex = [];
      for (let i of index) {
         let split = i.split('/');
         let idx = Number(split[0]);
         // -idx is counting from the last vertex, else convert 1-based index to 0-based index
         idx += (idx < 0) ? this._maker.getVertexLength() : -1;
         faceIndex.push( this._maker.getVertex(idx) );
         if (split.length > 1) {
            idx = Number(split[1]);      // uv is always the 2nd one
            if (idx !== 0) {  // 0 if face is 3 tuples of v//n 
               idx += (idx < 0) ? this._maker.getTexCoordLength(0) : -1;;
               uvIndex.push( idx );
            }
         }

      }
      this._maker.addFace(faceIndex, uvIndex);   // (current material)
   }

   usemtl(mat) {
      this._maker.useMaterial(mat[0]);
   }

   /**
    * hackup support for escape white space file name
    */
   mtllib(libraries) {
      let hackUp = "";
      for (let lib of libraries) {
         if (lib[lib.length-1] === '\\') {   // check if escape char at end;
            hackUp += lib.replace(/.$/," ");     // replace with white space
         } else if (hackUp) {
            lib = hackUp + lib;
            hackUp = "";
         }
         if (!hackUp) {
            const mtl = new MtlImporter(this._maker);
            this._maker.loadAsync(lib).then(file=>{
               mtl.import(file);
            });
            //this.mtl.set(lib, null);   // adds up
         }
      }
   }
}


class MtlImporter {
   constructor(maker) {
      this._maker = maker;
      this._current = null;
   }
  
   extension() {
      return "mtl";
   }

   fileTypes() {
      return ['mtl'];
   }

   // http://exocortex.com/blog/extending_wavefront_mtl_to_support_pbr
   static exportBlob(materialList) {
      let text = "#wings3d.net wavefront export\n";
      for (let material of materialList) {
         text += `newmtl ${material.name}\n`;
         text += `Kd ${material.pbr.baseColor[0]} ${material.pbr.baseColor[1]} ${material.pbr.baseColor[2]}\n`;
         text += `Pr ${material.pbr.roughness}\n`;
         text += `Pm ${material.pbr.metallic}\n`;
         text += `Ke ${material.pbr.emission[0]} ${material.pbr.emission[1]} ${material.pbr.emission[2]}\n`;
         let transparency = 1.0-material.pbr.opacity;
         text += `Tf ${transparency}\n`;
      }

      const blob = new Blob([text], {type: "text/plain;charset=utf-8"});
      return blob;
   }

   async import(blob) {
      const mtlText = await blob.text();
      // break the objText to lines we needs.
      const linesMatch = mtlText.match(/^[^\S\r\n]*(?:newmtl|Ka|Kd|Pr|Pm|ke|Ks|Ns|Tr|d|illum|map_Kd)(?:\s+(.+))$/gm);   //objText.match(/^v((?:\s+)[\d|\.|\+|\-|e|E]+){3}$/gm);

      if (linesMatch) {
         this._current = null;
      
         for (let line of linesMatch) {
            line = line.match(/\S+/g);            // === line.trim().split(/\s+/);
            let tag = line[0];
            this[tag](line);
         }
         
         // flush the last one
         this._flushCurrent();
      } 
   }
   
   _flushCurrent() {
       if (this._current) {   // 
         const mat = this._maker.addMaterialBlinnPhong(this._current.name, this._current.material, this._current.texture);
         
         this._current = null;
       }
   }

   /**
    * spec - "newmtl material_name"
    * @param {*} array - line split to component.
    */
   newmtl(array) {
      this._flushCurrent();
      const materialName = array[1];
      this._current = {material: {diffuseMaterial: [0.78, 0.81, 0.69], //Util.hexToRGB("#C9CFB1"),    // color, old style to be deleted.
                                 ambientMaterial: [0.78, 0.81, 0.69], //Util.hexToRGB("#C9CFB1"),    // color
                                 specularMaterial: [0, 0, 0],   // color
                                 emissionMaterial: [0, 0, 0],   // color
                                 },
                      texture: {},
                      name: materialName,
                             };
   }

   /**
    * we could use unary + operator, but parseFloat is clearer.
    * always return valid number.
    * @param {array} array - 3 number starting at index 1.
    */
   _parseRGB(array) {
      return [parseFloat(array[1]) || 0.0, parseFloat(array[2]) || 0.0, parseFloat(array[3]) || 0.0];
   }

   Ka(ambient) {
      this._current.material.ambientMaterial = this._parseRGB(ambient);
   }

   Kd(diffuse) {
      this._current.material.diffuseMaterial = this._parseRGB(diffuse);
   }

   Ke(emission) {
      this._current.material.emissionMaterial = this._parseRGB(emission);
   }

   /**
    * specular color "Ks r g b"
    * @param {string} specular - rgb color is floating point.
    */
   Ks(specular) {
      this._current.material.specularMaterial = this._parseRGB(specular);
   }

   /**
    * specular exponent "Ns exponent"- exponent range (0, 1000) - convert to 0-1.0
    * @param {string} exponent - line split
    */
   Ns(exponent) {
      let shine = (parseFloat(exponent[1]) || 0.0) / 1000.0;
      this._current.material.shininessMaterial = Math.min(1.0, Math.max(0.0, shine))
   }

   Pr(roughness) {
      this._current.material.roughnessMaterial = this._parseRGB(roughness);
   }

   Pm(metallic) {
      this._current.material.metallicMaterial = parseFloat(metallic[1]) || 0.1;
   }

   /**
    * transparent. fully opaque = 1.0, 
    * @param {array of string} opacity -  
    */
   d(opacity) {
      this._current.material.opacityMaterial = parseFloat(opacity[1]) || 1.0;
   }

   /**
    * transparent, other implementation. Tr = 1-d
    * @param {*} array 
    */
   Tr(transparent) {
      this._current.material.opacityMaterial = 1 - (parseFloat(transparent[1]) || 0.0);
   }

   /**
    * 
    * @param {*} number - which illumination shader.
    */
   illum(number) {

   }

   /**
    * paulbourke.net/dataformats/mtl
    * 
    * @param {*} - array
    */
   map_Kd(params) {
      function extractUV(index, values) {
         let u = values[index+1];
         let v = values[index+2];
         let w = values[index+3];
         let spliceOff = 4;
         if (isNaN(v)) {
            spliceOff = 2;
            v = 0;
         } else if (isNaN(w)) {
            spliceOff = 3;
         }
         values.splice(index, spliceOff);   // -s u v w
         return [u, v];
      };


      params.shift();
      const options = {};
      let pos = params.indexOf('-s');
      if (pos >= 0) {
         options.scale = extractUV(pos, params);
      }
      pos = params.indexOf('-o');
      if (pos >= 0) {
         options.offset = extractUV(pos, params);
      }
      pos = params.indexOf('-bm');
      if (pos >= 0) {
         options.bumpScale = parseFloat(params[pos+1]);
         params.splice(pos, 2);
      }
      pos = params.indexOf('-clamp');  // -clamp on|off
      if (pos >= 0) {
         if (params[pos+1].localeCompare('on') === 0) {
            options.wrapS = gl.CLAMP_TO_EDGE;
            options.wrapT = gl.CLAMP_TO_EDGE;
         }
         params.splice(pos, 2);
      }
      // ignore
      pos = params.indexOf('-t');   // -t u v w, turbulence for textures
      if (pos >= 0) {
         extractUV(pos, params);
      }
      for (const ignore of ['-cc', '-mm', 'imfchan', 'texres', 'blendu', 'blendv', '-boost']) {
         pos = params.indexOf(ignore);
         if (pos >= 0) {
            params.splice(pos, 2);
         }
      }

      // texture, 
      const uri = params.join('').trim();    // 

      const filename = uri;
      
      const texture = this._maker.addTexture(filename, true);
      
      this._maker.setBaseColorTexture(texture);
   }   
   
}


// add to load store.

async function importObj(files, maker) {
   const loader =  new WavefrontObjImporter(maker);
   return loader.import(files[0]);
}


export {
   importObj,
//   exportObj,
}
