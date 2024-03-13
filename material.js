/**
 * PBR material
 *
 * conversion from BlinnPhong
 *
 * 2019-02-19 - add pbr. ready to transition from opengl material to pbr.
 * 
 * 2020-08-08 - add texture. move all image and texture here ?
 * 
 * 2022-02-06 - move all gl code to glUtil. Refactor to use Depot(factory) to manage all material and texture.
 *    expose Warehouse interface only in order to controlled gpu resource allocation/deallocation. 
 */
 
import * as glUtil from "./glutil.js";
import {Float32PixelArray, allocBuffer} from "./pixelarray.js";



function hexToRGB(hex) {
   return [parseInt(hex.slice(1, 3), 16)/255,
           parseInt(hex.slice(3, 5), 16)/255,
           parseInt(hex.slice(5, 7), 16)/255];
};


function rgbToHex(r, g, b) {
   r = floatToHex(r);
   g = floatToHex(g);
   b = floatToHex(b);
   return `#${r}${g}${b}`;
};


const defaultHex = "#C9CFB1";
const redHex = "#FF0000";
const greenHex = "#00FF00";
const blueHex = "#0000FF";
const blackHex = "#000000";
function getPBR(hexColor) {
   return { baseColor: hexToRGB(hexColor),               // rgb, baseColor, 
            emission: hexToRGB("#000000"),               // rgb, intensity
            roughness: 0.8,                                   // float, 0-1.0
            metallic: 0.1,                                    // float, 0-1.0
            opacity: 1,                                       // float, 0-1.0
          };
};



const PBRK = {
   baseColor: 0,
   emission: 3,
   roughness: 6,
   metallic: 7,                                                      
   opacity: 8,
   sizeOf: 9,
};
/**
 * PhysicallyBasedMaterial
 */

function textureTypes() {
   return ['baseColorTexture', "roughnessTexture", 'normalTexture', 'occlusionTexture', "emissionTexture", ];
}

/**
  * https://github.com/AnalyticalGraphicsInc/obj2gltf
  * convert rgb to luminance
 */
function luminance(rgb) {
   return (rgb[0] * 0.2125) + (rgb[1] * 0.7154) + (rgb[2] * 0.0721);
}

/**
 * Translate the blinn-phong model to the pbr metallic-roughness model
 * Roughness factor is a combination of specular intensity and shininess
 * Metallic factor is 0.0
 */
function blinnPhongToPBR(material) {

   const specularIntensity = luminance(material.specularMaterial);
   let roughnessFactor = 1.0 - material.shininessMaterial;
   
   // Low specular intensity values should produce a rough material even if shininess is high.
   if (specularIntensity < 0.1) {
      roughnessFactor *= (1.0 - specularIntensity);
   }
   if (material.roughnessMaterial) {
      roughnessFactor = material.roughnessMaterial;
   }

   return {baseColor: material.diffuseMaterial, 
           metallic: material.metallicMaterial || 0.1,
           roughness: roughnessFactor,
           emission: material.emissionMaterial,
           opacity: material.opacityMaterial || 1.0,
          };
}




class MaterialDepot {
   constructor(gl) {
      glUtil.setConstant(gl);
      this._gpu = Float32PixelArray.create(PBRK.sizeOf, 3);
      this._warehouse = [];
      //this._textureDepot = new TextureDepot();
      // create initial white texture, 
      //this._WHITE = this._textureDepot.create(gl, "WHITE");
      //glUtil.setWHITE(gl, this._WHITE);
      // create default Material
      this._default = this.create(gl, "default", getPBR(defaultHex));
      this._red = this.create(gl, "default_red", getPBR(redHex));
      this._green = this.create(gl, "default_green", getPBR(greenHex));
      this._blue = this.create(gl, "default_blue", getPBR(blueHex));
      this._black = this.create(gl, "default_black", getPBR(blackHex));
   }
   
   getDefault() {
      return this._default;
   }
   
   getRed() {
      return this._red;
   }
   
   getBlue() {
      return this._green;
   }
   
   getGreen() {
      return this._blue;
   }
   
   getBlack() {
      return this._black;
   }
   
//   get t() {
//      return this._textureDepot;
//   }
   
   * getInUse() {
      for (let i = 0; i < this._warehouse.length; ++i) {
         if (this._warehouse[i]._usageCount > 0) {
            yield i;
         }
      }
   }

   create(gl, name, input) {
      if (this._gpu.capacity() < 1) {  // expand if no capacity
         let size = this._gpu.maxLength();
         if (size === 0) {
            size = glUtil.MAX_TEXTURE_SIZE;
         } else {
            size *= 1.5;
         }
         this._gpu.setBuffer(allocBuffer(this._gpu.computeBufferSize(size)), 0, size);
      }
      const handle = this._gpu.appendNew();
      // set all texture to WHITE, BLACK?
      const attr = this._warehouse.push( {_name: name, 
                                          _usageCount: 0, } );
 /*                                         _texture: { 
                                             baseColorTexture: this._WHITE,    // baseColor is 1.0, WHITE
                                             roughnessTexture: this._WHITE,    // all else is 0, BLACK
                                             normalTexture: this._WHITE,       
                                             occlusionTexture: this._WHITE,
                                             emissionTexture: this._WHITE,    
                                          }} );
      this._textureDepot.addRef(this._WHITE, 5); */
      if (input) {
         this.setValues(handle, input);
      }
      
      return handle;
   }
   
   createBlinnPhong(gl, name, old) {
      return create(gl, name, blinnPhongToPBR(old));
   }
   
   createTexture(gl) {
      return this._gpu.createDataTexture(gl);
   }
   
   delete(handle) {
      if ((handle > 0) && this._isValid(handle)) {
         const dead = this._warehouse[handle];
         if (dead._usageCount === 0) {
/*          // release texture all
            for (let texture of textureTypes()) {
               this._textureDepot.releaseRef(dead._texture[texture]);
               dead._texture[texture] = null;
            }
            // this._freeList.push(material);*/
            return true;
         }
      }
      return false;
   }
   
   _isValid(handle) {
      if ((handle < 0) || (handle >= this._warehouse.length)) {
         console.log("Material is out of bound: " + handle);
         return false;
      }
      return true;
   }   
   
   // 
   addRef(handle, count=1) {
      if (this._isValid(handle)) {
         this._warehouse[handle]._usageCount += count;
      }
   }
   
   releaseRef(handle, count=1) {
      this.addRef(handle, -count);
   }
   
   isDefault(handle) {
      return (handle === this._default);  // zeroth element is the default
   }
   
   /**
   * return a string compose of texture's index, which act as hash. or should we packed the texture as int32?
   */
//   textureHash(handle) {
//      return `${this.getBaseColorTexture(handle)}`;
//   }

   isInUse(handle) {
      if (this._isValid(handle)) {
         return this._warehouse[handle]._usageCount > 0;
      }
      return false;
   }
   
/*   removeTexture(handle, textureType) {
      this.setTexture(handle, textureType, this._WHITE);
   }
   
   getTexture(handle, textureType) {
      let tex = null;
      if (this._isValid(handle)) {
         tex = this._warehouse[handle]._texture[textureType];          
      }
      return tex;
   }
   
   setTexture(handle, textureType, textureHandle) {
      if (this._isValid(handle)) {
      	let oldTexture = this.getTexture(handle, textureType);
      	if ((oldTexture) && (oldTexture !== textureHandle)) {
      	   // release previous
            this._textureDepot.releaseRef(oldTexture);
            // assign new one
            this._warehouse[handle]._texture[textureType] = textureHandle;
            this._textureDepot.addRef(textureHandle);
            return true;
      	}   
      }
      return false;
   }*/
   
   setValues(handle, inputDat) {
      if (this._isValid(handle)) {
         for (const [key, value] of Object.entries(inputDat)) {
            switch (key) {
               case "baseColor":
               case "emission":
                  this._gpu.setVec3(handle, PBRK[key], value);   // hexToRGB(value);
                  break;
               case "roughness":
               case "metallic":
               case "opacity":
                  this._gpu.set(handle, PBRK[key], value);           // parseFloat(value);
                  break;
               default: // what about texture? and textureTexcoord?
                  console.log("Unrecognized PBR material: " + key); 11                 
            }
         }
      }
   }
   
   name(handle) {
      if (this._isValid(handle)) {
         return this._warehouse[handle]._name;
      }
      return "invalid";
   }

   setName(handle, newName) {
      if (this._isValid(handle)) {
         this._warehouse[handle]._name = newName;
         return newName;
      }
      return "invalid";
   }
   
   // baseColor: hexToRGB("#C9CFB1"),              // rgb, baseColor, 
   getBaseColor(handle) {
      let color = [0, 0, 0];
      if (this._isValid(handle)) {
         this._gpu.getVec3(handle, PBRK.baseColor, color);
      }
      return color;
   }
   
   setBaseColor(handle, color) {
      if (this._isValid(handle)) {
         return this._gpu.setVec3(handle, PBRK.baseColor, color);
      }
      return false;
   }
   
/*   getBaseColorTexture(handle) {
      return this.getTexture(handle, "baseColorTexture");
   }
    
   setBaseColorTexture(handle, color) {
      return this.setTexture(handle, "baseColorTexture", color);
   }*/
   
   // roughness: 0.8,                                   // float, 0-1.0
   getRoughness(handle) {
      if (this._isValid(handle)) {
         return this._gpu.get(handle, PBRK.roughness);
      }
      return 0.0;
   }
   
   setRoughness(handle, roughness) {
      if (this._isValid(handle)) {
         return this._gpu.set(handle, PBRK.roughness, roughness);
      }
      return false;
   }
   
/*   getRoughnessTexture(handle) {
      return this.getTexture(handle, "roughnessTexture");
   }

   setRoughnessTexture(handle, roughnessTexture) {
      return this.setTexture(handle, "roughnessTexture", roughnessTexture);
   }*/
   
   // metallic: 0.1,                                    // float, 0-1.0
   getMetallic(handle) {
      if (this._isValid(handle)) {
         return this._gpu.get(handle, PBRK.metallic);
      }
      return 0.0;
   }
   
   setMetallic(handle, metallic) {
      if (this._isValid(handle)) {
         return this._gpu.set(handle, PBRK.metallic, metallic);
      }
      return false;
   }
  
   // emission: hexToRGB("#000000"),               // rgb, intensity
   getEmission(handle) {
      const emission = [0.0, 0.0, 0.0];
      if (this._isValid(handle)) {
         this._gpu.getVec3(handle, PBRK.emission, emission);
      }
      return emission;
   }
      
   setEmission(handle, emission) {
      if (this._isValid(handle)) {
         return this._gpu.setVec3(handle, PBRK.emission, emission);
      }
      return false;
   }
   
/*   getEmissionTexture(handle) {
      return this.getTexture(handle, "emissionTexture");
   }

   setEmissionTexture(handle, emission) {
      this.setTexture(handle, "emissionTexture", emission);
   }*/
   
   // opacity: 1,                                       // float, 0-1.0
   getOpacity(handle) {
      if (this._isValid(handle)) {
         return this._gpu.get(handle, PBRK.opacity);
      }
      return 1;
   }
   
   setOpacity(handle, opacity) {
      if (this._isValid(handle)) {
         return this._gpu.set(handle, PBRK.opacity, opacity);
      }
      return false;
   }                        
   
/*   getNormalTexture(handle) {
      return this.getTexture(handle, "normalTexture");
   }
   
   setNormalTexture(handle, normal) {
      return this.setTexture(handle, "normalTexture", normal);
   }
   
   getOcclusionTexture(handle) {
      return this.getTexture(handle, "occlusionTexture");
   }
   
   setOcclusionTexture(handle, occlusion) {
      return this.setTexture(texture, "occlusionTexture", occlusion);
   }
   
   getOcclusionTexcoord(handle) {
   
   }*/
   
   getUniforms(handle) {                  // REMOVAL CANDIDATE.
/*      if (this._isValid(handle)) {
         return ()=> {
            const baseColorTexture = this.getBaseColorTexture(handle);
            return {
               u_baseColorTexture: {type: "sampler2D", value: baseColorTexture},
            
            };
         }
      } */
      return ()=>{
         return {};
      };
   }
}



// Texture parameters can be passed in via the `options` argument.
// Example usage:
//
//     var t = new GL.Texture(256, 256, {
//       // Defaults to gl.LINEAR, set both at once with "filter"
//       magFilter: gl.NEAREST,
//       minFilter: gl.LINEAR,
//
//       // Defaults to gl.CLAMP_TO_EDGE, set both at once with "wrap"
//       wrapS: gl.REPEAT,
//       wrapT: gl.REPEAT,
//
//       format: gl.RGB, // Defaults to gl.RGBA
//       type: gl.FLOAT // Defaults to gl.UNSIGNED_BYTE
//     });
class Texture {
   constructor(gl, name, options) {
      this._name = name;
      this._usageCount = 0;    // the number of materials that contains this Texture.
      this._sampler = glUtil.defaultSampler(gl);
      this.setSampler(options);
   }

   addRef(count) {
      this._usageCount += count;
   }
   
   usageCount() {
      return this._usageCount;
   }
   
   getImage() {
      return this._image;
   }

   /**
    * 
    * image - (dom image, or canvas), - 
    */
   setImage(gl, handle, image) {
      this._image = image;

      glUtil.setImage(gl, handle, image, this._sampler);

      return this._image;
   }

   /**
    * imageData - (ImageData)
    */
   setImageData(handle, imageData) {
      let canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      let ctx = canvas.getContext('2d');
      ctx.putImageData(imageData, 0, 0);

      return this.setImage(handle, canvas);
   }

   setSampler(options) {
      if (options) {
         for (let [key, value] of Object.entries(options)) {
            this._sampler[key] = value;
         }
      }
   }
}


class TextureDepot {
   constructor() {
      this._warehouse = new Map;
   }
   
   create(gl, name, sampler) {
      const handle = gl.createTexture();
      const texture = new Texture(gl, name, sampler);
      texture.setImage(gl, handle, glUtil.getCHECKERBOARD());    // default checkerboard. we need default because loading texture might failed or loading later than first rendering.
      this._warehouse.set(handle, texture);
      
      return handle;
   }
   
   delete(gl, textureHandle) {
      if (this._warehouse.has(textureHandle)) {
         const texture = this._warehouse.get(textureHandle);
         if (texture.usageCount() === 0) {
            this._warehouse.delete(textureHandle);
            gl.deleteTexture(textureHandle);
         } else {
            console.log("Texture is not free: " + texture.usageCount());
         }
      } else {
         console.log("unknown texture handle: " + textureHandle);
      }
   }
   
   addRef(texture, count=1) {
      const tex = this._warehouse.get(texture);
      if (tex) {
         tex.addRef(count);
      }
   }
   
   releaseRef(texture, count=1) {
      this.addRef(texture, -count);
   }
   
   getImage(texHandle) {
      const tex = this._warehouse.get(texHandle);
      if (tex) {
         return tex.getImage();
      }
      return null;
   }
   
   setImage(gl, textureHandle, image) {
      const tex = this._warehouse.get(textureHandle);
      if (tex) {
         tex.setImage(gl, textureHandle, image);
      } 
   }
   
   setSampler(gl, texture, sampler) {
      const tex = this_warehouse.get(texture);
      if (tex) {
         tex.setSampler(gl, image);
      }
   }
   
   setName(texture, name) {
      const tex = this._warehouse.get(texture);
      if (tex) {
         tex.setName(name);
      }
   }

};

 

export {
   MaterialDepot,
   TextureDepot,
   hexToRGB,
   rgbToHex,
   blinnPhongToPBR,
};
