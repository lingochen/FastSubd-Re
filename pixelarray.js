/**
 *  mainly to provide Uint32Array and Float32Array for use.
 * @module PixelArray
 * 
*/



import {makeDataTexture, makeDataTexture3D, MAX_TEXTURE_SIZE} from './glutil.js';

/** webgl2 constant. copied only what we needs texturing data. */
const PixelTypeK = {
   BYTE: 0x1400,
   UNSIGNED_BYTE: 0x1401,
   SHORT: 0x1402,
   UNSIGNED_SHORT: 0x1403,
   INT: 0x1404,
   UNSIGNED_INT: 0x1405,
   HALF_FLOAT: 0x140B,
   FLOAT: 0x1406,
};
Object.freeze(PixelTypeK);
const PixelFormatK = {
   RED: 0x1903,
   RED_INTEGER: 0x8D94,
   RG: 0x8227,
   RG_INTEGER: 0x8228,
   RGB: 0x1907,
   RGB_INTEGER: 0x8D98,
   RGBA: 0x1908,
   RGBA_INTEGER: 0x8D99,
};
Object.freeze(PixelFormatK);
const PixelInternalFormatK = {
   R8: 0x8229,
   RG8: 0x822B,
   RGB8: 0x8051,
   RGBA8: 0x8058,
   R32I: 0x8235,
   RG32I: 0x823B,
   RGB32I: 0x8D83,
   RGBA32I: 0x8D82,
   RG16F: 0x822F,
   RGB16F: 0x881B,
   R32F: 0x822E,
   RG32F: 0x8230,
   RGB32F: 0x8815,
   RGBA32F: 0x8814,
}
Object.freeze(PixelInternalFormatK);



/** class managing typedArray so that it can be used as gpu Texture directly. */
class PixelArray {
   // should be called by create/workerCopy only.
   constructor(pixel, record, blob) {
      this._pixel = pixel;
      this._rec = record;
      this._blob = blob;
      this._set = this._setNoCheck;    //this._setWithCheck;
      this._fillValue = 0;
      if (blob) {
         this._set = this._setNoCheck; // must be workerCopy, used by subdivide, so don't check.
      }
   }

   /**
    * create typedArray with specfic type.
    * @param {number} structSize - the size of structure we want to represent
    * @param {number} channelPrecision - # of bytes of TypedArray typed.
    * @param {number} channelCount - # of channels per pixel. ie.. (rgba) channels.
    * @param {number} internalFormat - specific precision format.
    * @param {number} pixelFormat - webgl format.
    */
   static _createInternal(structSize, channelPrecision, channelCount, internalFormat, pixelFormat) {
      //this._structSize = structSize;
      const pixel = {
         byteCount: channelPrecision,                                // format's size in byte.
         channelCount: channelCount,                                 // number of channels per pixel. ie.. (rgba) channels
         internalFormat, internalFormat,
         format: pixelFormat,                                        // the real webgl format.
      };
      const record = {
         structStride: Math.ceil(structSize/channelCount)*channelCount,   // number of pixels to store a structure.
      //this._allocatedStruct = 0;                                   // number of structure allocated.
         usedSize: 0,                                            // current allocated array in native type
         gpuSize: 0,                                             // current allocated gpu texture in native type.
         alteredMin: 0,                                          // in native type
         alteredMax: -1,
      }
      //self._set = this._setWithCheck;
      return [pixel, record];
   }

   getDehydrate(obj) {
      obj.className = this.constructor.name;
      obj._pixel = this._pixel;
      obj._rec = this._rec;
      obj._sharedBuffer = this._blob.buffer;
      return obj;
   }

   /**
    * get total byte length
    * @returns {number} - total used bytes.
    */
   byteLength() {
      return this._rec.usedSize * this._pixel.byteCount;
   }
   
   /**
    * get the struct length
    * @returns {number} - current used length. not typed length but struct length
    */
   length() {
      return (this._rec.usedSize / this._rec.structStride);
   }


   /**
    * return typedArray including unused part. unsafed access but no extra runtime cost.
    * @returns {typedArray} -  
    */
   getBuffer() {
      return this._blob;
   }
   
   /**
    * return only the current used part of typedArray. safe access, creating a new typedArray, slight runtime cost.
    * @returns {typedArray} - subarray of currently used typedArray 
    */
   makeUsedBuffer() {
      return this._blob.subarray(0, this._rec.usedSize);
   }

   createDataTexture(gl) {
      const buffer = this.getBuffer();
      const tex = makeDataTexture(gl, buffer, this._pixel.internalFormat, this._pixel.format, this._getType(), buffer.length/this._pixel.channelCount);
      return tex;
   }
   
   getTextureParameter() {
      return {internalFormat: this._pixel.internalFormat,
              format: this._pixel.format,
              channelCount: this._pixel.channelCount,
              type: this._getType(),
             };
   }

   /**
    * get currently changed part of typedArray. (alteredMin, alteredMax). Todo: an hierachy of changed part, 
    * aligned to pixel, much easier to reason about.
    * @returns {Object} - return {offset, subArray} of current changed typedArray.
    */
   getChanged() {
      let start = Math.floor(this._rec.alteredMin/this._rec.structStride) * this._rec.structStride;
      let end =  (Math.floor(this._rec.alteredMax/this._rec.structStride)+1) * this._rec.structStride;
      return {byteOffset: start*this._pixel.byteCount,
              array: this._blob.subarray(start, end)};
   }

   getInterval(formatChannel) {
      const ret = {start: 0, end: 0};
      if (this.isAltered()) {
         ret.start = Math.floor(this._rec.alteredMin/formatChannel) * formatChannel;
         ret.end =  (Math.floor(this._rec.alteredMax/formatChannel)+1) * formatChannel;
      }
      return ret;
   }

   /**
    * 
    */
   alloc() {
      const index = this._rec.usedSize / this._rec.structStride;
      this._rec.usedSize += this._rec.structStride;
      if (this._rec.usedSize > this._blob.length) {
         this.expand();
      }
      return index;
   }
   
   allocEx(size) {
      const index = this._rec.usedSize / this._rec.structStride;
      this._rec.usedSize += this._rec.structStride * size;
      if (this._rec.usedSize > this._blob.length) {
         this.expand(this._rec.usedSize);
      }
      return index;
   }
   
   //
   // remove from end
   //
   deallocEx(size) {
      this._rec.usedSize -= this._rec.structStride * size;
      // do we do contraction here?
      
      // return new end
      return this._rec.useSize / this._rec.structStride;
   }

   computeAllocateSize(size) {
      // allocation align to textureWidth.
      return Math.ceil(size / MAX_TEXTURE_SIZE) * MAX_TEXTURE_SIZE * this._pixel.channelCount;
   }

   /**
    * expand by 1.5x of oldSize if not given a newSize.
    */
   expand(newSize) {
      if (!newSize) {   // resize to larger by 1.5x of oldSize
         newSize = MAX_TEXTURE_SIZE;
         if (this._blob) {
            newSize = 1.5 * this._blob.length;
         }
      }
      // allocation
      const oldBuffer = this._blob;
      this._blob = this._allocateBuffer(newSize);
      this._blob.fill(this._fillValue);
      if (oldBuffer) {
         this._blob.set(oldBuffer);
      }
   }
   
   setFill(value) {
      this._fillValue = value;
      this._blob.fill(this._fillValue);
   }
   
   addToVec2(data, index, field) {
      index = index * this._rec.structStride + field;
      data[0] += this._get(index);
      data[1] += this._get(index+1);
      return data;
   }
      
   _get(index) {
      return this._blob[index];
   }

   get(index, field) {
      return this._blob[index*this._rec.structStride + field];
   }

   getVec2(index, field, data) {
      index = index * this._rec.structStride + field;
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      return data;
   }
   
   getVec3(index, field, data) {
      index = index * this._rec.structStride + field;
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      data[2] = this._get(index+2);
      return data;
   }
   
   getVec4(index, field, data) {
      index = index * this._rec.structStride + field;
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      data[2] = this._get(index+2);
      data[3] = this._get(index+3);
      return data;
   }

   _setValues(index, array) {
      this._blob.set(array, index);
      return true;
   }
   
   _setNoCheck(index, newValue) {
      this._blob[index] = newValue;
      return true;
   }
   
   _setWithCheck(index, newValue) {
      if (this._blob[index] !== newValue) {
         this._blob[index] = newValue;
         if (index < this._rec.alteredMin) {
            this._rec.alteredMin = index;
         }
         if (index > this._rec.alteredMax) {
            this._rec.alteredMax = index;
         }
         return true;
      }
      return false;
   }

   set(index, field, newValue) {
      index = index * this._rec.structStride + field;
      return this._set(index, newValue);
   }
   
   setVec2(index, field, data) {
      index = index * this._rec.structStride + field;
      let ret = this._set(index, data[0]);            // TODO: is it better to use bitwise (!) ?
      ret = this._set(index+1, data[1]) || ret;
      return ret;
   }
   
   setVec3(index, field, data) {
      index = index * this._rec.structStride + field;
      let ret = this._set(index, data[0]);
      ret = this._set(index+1, data[1]) || ret;
      ret = this._set(index+2, data[2]) || ret;
      return ret;
   }
   
   setVec4(index, field, data) {
      index = index * this._rec.structStride + field;
      let ret = this._set(index, data[0]);
      ret = this._set(index+1, data[1]) || ret;
      ret = this._set(index+2, data[2]) || ret;
      ret = this._set(index+3, data[3]) || ret;
      return ret;
   }
   
   _setCheckOn() {
      this._set = this._setWithCheck;
   }  
   
   _setCheckOff() {
      this._set = this._setNoCheck;
   }

   /**
    * after copying memory to gpu, reset the alteredXXX.
    */
   _resetCounter() {
      this._rec.alteredMin = this._blob ? this._blob.length : 0;
      this._rec.alteredMax = -1;
   }

   _resetLength() {
      this._rec.gpuSize = this._rec.usedSize;
   };

   isAltered() {
      return (this._rec.alteredMin <= this._rec.alteredMax);
   };

   isLengthAltered() {
      return (this._rec.gpuSize !== this._rec.usedSize);
   }
}


class Uint8PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }
   
   static rehydrate(self) {
      if (self._pixel && self._rec && self._sharedBuffer) {
         const blob = new Uint8Array(self._sharedBuffer);
         return new Uint8PixelArray(self._pixel, self._rec, blob);
      }
      throw("Int32PixelArray rehydrate: bad input");
   }
   
   static create(structSize, numberOfChannel, allocationSize) {
      let format = PixelFormatK.RED_INTEGER;
      let internalFormat = PixelInternalFormatK.R8;
      switch (numberOfChannel) {
         case 1:
            break;
         case 2:
            format = PixelFormatK.RG_INTEGER;
            internalFormat = PixelInternalFormatK.RG8;
            break;
        case 3:
            format = PixelFormatK.RGB_INTEGER;
            internalFormat = PixelInternalFormatK.RGB8;
            break;
        case 4:
            format = PixelFormatK.RGBA_INTEGER;
            internalFormat = PixelInternalFormatK.RGBA8;
            break;
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      // now allocated data
      const [pixel, record] = PixelArray._createInternal(structSize, 1, numberOfChannel, internalFormat, format);
      const ret = new Uint8PixelArray(pixel, record, null);
      ret.expand(allocationSize);
      return ret;
   }
   
     
   _allocateBuffer(size) {
      return new Uint8Array(new SharedArrayBuffer(this.computeAllocateSize(size)*4));
   }

   _getType() {
      return PixelTypeK.UNSIGNED_BYTE;
   }
}


class Int32PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }

   static rehydrate(self) {
      if (self._pixel && self._rec && self._sharedBuffer) {
         const blob = new Int32Array(self._sharedBuffer);
         return new Int32PixelArray(self._pixel, self._rec, blob);
      }
      throw("Int32PixelArray rehydrate: bad input");
   }

   static create(structSize, numberOfChannel, allocationSize) {
      let format = PixelFormatK.RED_INTEGER;
      let internalFormat = PixelInternalFormatK.R32I;
      switch (numberOfChannel) {
         case 1:
            break;
         case 2:
            format = PixelFormatK.RG_INTEGER;
            internalFormat = PixelInternalFormatK.RG32I;
            break;
        case 3:
            format = PixelFormatK.RGB_INTEGER;
            internalFormat = PixelInternalFormatK.RGB32I;
            break;
        case 4:
            format = PixelFormatK.RGBA_INTEGER;
            internalFormat = PixelInternalFormatK.RGBA32I;
            break;
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      // now allocated data
      const [pixel, record] = PixelArray._createInternal(structSize, 4, numberOfChannel, internalFormat, format);
      const ret = new Int32PixelArray(pixel, record, null);
      ret.expand(allocationSize);
      return ret;
   }
   
   _allocateBuffer(size) {
      return new Int32Array(new SharedArrayBuffer(this.computeAllocateSize(size)*4));
   }

   _getType() {
      return PixelTypeK.INT;
   }
}


class Float32PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }

   static rehydrate(self) {
      if (self._pixel && self._rec && self._sharedBuffer) {
         const blob = new Float32Array(self._sharedBuffer);
         return new Float32PixelArray(self._pixel, self._rec, blob);
      }
      throw("Float32PixelArray rehydrate: bad Input");
   }

   static create(structSize, numberOfChannel, allocationSize) {
      let format = PixelFormatK.RED;
      let internalFormat = PixelInternalFormatK.R32F;
      switch (numberOfChannel) {
        case 1:
           break;
        case 2:
           format = PixelFormatK.RG;
           internalFormat = PixelInternalFormatK.RG32F;
           break;
        case 3:
           format = PixelFormatK.RGB;
           internalFormat = PixelInternalFormatK.RGB32F;
           break;
        case 4:
           format = PixelFormatK.RGBA;
           internalFormat = PixelInternalFormatK.RGBA32F;
           break;
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      // now allocated data
      const [pixel, record] = PixelArray._createInternal(structSize, 4, numberOfChannel, internalFormat, format);
      const ret = new Float32PixelArray(pixel, record, null);
      ret.expand(allocationSize);
      return ret;
   }
   
   _allocateBuffer(size) {
      return new Float32Array(new SharedArrayBuffer(this.computeAllocateSize(size)*4));
   }

   _getType() {
      return PixelTypeK.FLOAT;
   }
}


class Float16PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }

   static rehydrate(self) {
      if (self._pixel && self._rec && self._sharedBuffer) {
         const blob = new Uint16Array(self._sharedBuffer);
         return new Float16PixelArray(self._pixel, self._rec, blob);
      }
      throw("Float16PixelArray rehydrate: bad input");
   }

   static create(structSize, numberOfChannel, allocationSize) {
      let format = PixelFormatK.RG;
      let internalFormat = PixelInternalFormatK.RG16F;
      switch (numberOfChannel) {
        case 2:
           break;
        case 3:
           format = PixelFormatK.RGB;
           internalFormat = PixelInternalFormatK.RGB16F;
           break;
        case 1:
           format = PixelFormatK.RED;
           internalFormat = PixelInternalFormatK.R16F;
           break;
        case 4:
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      
      // now allocated data
      const [pixel, record] = PixelArray._createInternal(structSize, 2, numberOfChannel, internalFormat, format);
      const ret = new Float16PixelArray(pixel, record, null);
      ret.expand(allocationSize);
      return ret;
   }
   
   _allocateBuffer(size) {
      return new Uint16Array(this.computeAllocateSize(size));
   }
   
   _getType() {
      return PixelTypeK.HALF_FLOAT;
   }
   
   _get(index) {
      return fromHalf( super._get(index) );
   }
   
   get(index, field) {
      return fromHalf( super.get(index, field) );
   }
   
   _setNoCheck(index, newValue) {
      return super._setNoCheck(index, toHalf(newValue) );
   }
   
   _setWithCheck(index, newValue) {
      return super._setWithCheck(index, toHalf(newValue) );
   }
}




/**
 * array of PixelArray, PixelArray is a 2d texture, so array of 2d is 3d texture.
 */
class PixelArray3D {
   constructor(array3d) {
      this._texture3d = array3d;
   }
   
   static _rehydrateInternal(self, rehydrator) {
      if (self._texture3d) {
         const texture3d = [];
         for (let pixelArray of self._texture3d) {
            texture3d.push( rehydrate(pixelArray) );
         }
         return texture3d;
      }
      throw("TexCoordPixelArray3D rehydrate: bad input");
   }

   getDehydrate(obj) {
      obj.className = this.constructor.name;
      obj._texture3d = [];
      for (let pixelArray of this._texture3d) {
         obj._texture3d.push( pixelArray.getDehydrate({}) );
      }
      return obj;
   }
   
   static _createInternal(depth, structSize, numberOfChannel, allocationSize, creator) {
      const array3d = [];
      for (let i = 0; i < depth; ++i) {
          array3d.push( creator(structSize, numberOfChannel, allocationSize) );
      }
      return array3d;
   }
   
   createDataTexture(gl) {
      const texture3d = [];
      const param = this._texture3d[0].getTextureParameter();
      for (let texture of this._texture3d) {
         texture3d.push( texture.getBuffer() );
      }
      const tex = makeDataTexture3D(gl, texture3d, param.internalFormat, param.format, param.type, texture3d[0].length/param.channelCount);
      return tex;
   }

   depth() {
      return this._texture3d.length;
   }
   
   /**
    * get total byte length
    * @returns {number} - total used bytes.
    */
   byteLength() {
      return this._texture3d[0].byteLength(); // * this._uvs.length;
   }
   
   /**
    * get the struct length
    * @returns {number} - current used length. not typed length but struct length
    */
   length() {
      return this._texture3d[0].length();
   }

   /**
    * return typedArray including unused part. unsafed access but no extra runtime cost.
    * @returns {typedArray} -  
    */
   * getBuffer() {
      for (let array of this._texture3d) {
         yield array.getBuffer();
      }
   }
   
   /**
    * return only the current used part of typedArray. safe access, creating a new typedArray, slight runtime cost.
    * @returns {typedArray} - subarray of currently used typedArray 
    */
   * makeUsedBuffer() {
      for (let array of this._texture3d) {
         yield array.makeUsedBuffer();
      }
   }

   /**
    * get currently changed part of typedArray. (alteredMin, alteredMax). Todo: an hierachy of changed part, 
    * aligned to pixel, much easier to reason about.
    * @returns {Object} - return {offset, subArray} of current changed typedArray.
    */
   * getChanged() {
      for (let array of this._texture3d) {
         yield array.getChanged();
      }
   }

   * getInterval(formatChannel) {
      for (let array of this._texture3d) {
         yield array.getInterval(formatChannel);
      }
   }
   
   alloc() {
      let i = -1;
      for (let pixelArray of this._texture3d) {
         i = pixelArray.alloc();
      }
      return i;
   }
   
   allocEx(count) {
      for (let pixelArray of this._texture3d) {
         pixelArray.allocEx(count);
      }
   }
   
   addTo(index, field, layer, newValue) {
      return this._texture3d[layer].addTo(index, field, value);
   }
   
   get(index, field, layer) {
      return this._texture3d[layer].get(index, field);
   }
   
   set(index, field, layer, newValue) {
      // should we check out of bounds?
      this._texture3d[layer].set(index, field, newValue);
   }
   
   addToVec2(data, index, field, layer) {
      return this._texture3d[layer].addToVec2(data, index, field);
   }
   
   getVec2(index, field, layer, data2) {
      //if (layer < this._uvs.length) {
         this._texture3d[layer].getVec2(index, field, data2);
      //}
      return data2;
   }
   
   setVec2(index, field, layer, value2) {
      //if (layer < this._uvs.length) {
         this._texture3d[layer].setVec2(index, 0, value2);
         return true;
      //}
      //return false;
   }
};


class Int32PixelArray3D extends PixelArray3D {
   constructor(array3d) {
      super(array3d);
   }
   
   static rehydrate(self) {
      const array3d = PixelArray3D._rehydrateInternal(self, Int32PixelArray.rehydrate);
      return new Int32PixelArray3D(array3d);
   }
   
   static create(depth, structSize, numberOfChannel, allocationSize) {
      const array3d = PixelArray3D._createInternal(depth, structSize, numberOfChannel, allocationSize, Int32PixelArray.create);
      return new Int32PixelArray3D(array3d);   
   }
}


/**
 * [u, v] fp16, 32bits each,
 * array of arrays of [u,v] 
 */
// class TexCoordPixelArray3D {}
// just use Float16PixelArray3D 
class Float16PixelArray3D extends PixelArray3D {
   constructor(array3d) {
      super(array3d);
   }
   
   static rehydrate(self) {
      const array3d = PixelArray3D._rehydrateInternal(self, Float16PixelArray.rehydrate);
      return new Float16PixelArray3D(array3d);
   }
   
   static create(depth, structSize, numberOfChannel, allocationSize) {
      const array3d = PixelArray3D._createInternal(depth, structSize, numberOfChannel, allocationSize, Float16PixelArray.create);
      return new Float16PixelArray3D(array3d);
   }
}


class Float32PixelArray3D extends PixelArray3D {
   constructor(array3d) {
      super(array3d);
   }
   
   static rehydrate(self) {
      const array3d = PixelArray3D._rehydrateInternal(self, Float32PixelArray.rehydrate);
      return new Float32PixelArray3D(array3d);
   }
   
   static create(depth, structSize, numberOfChannel, allocationSize) {
      const array3d = PixelArray3D._createInternal(depth, structSize, numberOfChannel, allocationSize, Float32PixelArray.create);
      return new Float32PixelArray3D(array3d);
   }
}




/*******************************************************************************
 * 32bit to 16bit float encoding/decoding functions. 
 */
/**
 * Candidate for WASM.
 * https://stackoverflow.com/questions/32633585/how-do-you-convert-to-half-floats-in-javascript
 */
const toHalf = (function() {
   let floatView = new Float32Array(1);
   let int32View = new Int32Array(floatView.buffer);
 
   // This method is faster than the OpenEXR implementation (very often
   // used, eg. in Ogre), with the additional benefit of rounding, inspired
   // by James Tursa?s half-precision code. 
   return function toHalf(value) {
     floatView[0] = value;     // float32 conversion here
     var x = int32View[0];
 
     var bits = (x >> 16) & 0x8000; // Get the sign 
     var m = (x >> 12) & 0x07ff; // Keep one extra bit for rounding 
     var e = (x >> 23) & 0xff; // Using int is faster here 
 
     // If zero, or denormal, or exponent underflows too much for a denormal half, return signed zero. 
     if (e < 103) {
       return bits;
     }
 
     // If NaN, return NaN. If Inf or exponent overflow, return Inf. 
     if (e > 142) {
       bits |= 0x7c00;
       // If exponent was 0xff and one mantissa bit was set, it means NaN, not Inf, so make sure we set one mantissa bit too. 
       bits |= ((e == 255) ? 0 : 1) && (x & 0x007fffff);
       return bits;
     }
 
     // If exponent underflows but not too much, return a denormal
     if (e < 113) {
       m |= 0x0800;
       // Extra rounding may overflow and set mantissa to 0 and exponent to 1, which is OK.
       bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
       return bits;
     }
 
     bits |= ((e - 112) << 10) | (m >> 1);
     // Extra rounding. An overflow will set mantissa to 0 and increment the exponent, which is OK. 
     bits += m & 1;
     return bits;
   }
}());

/**
 * 
 * https://stackoverflow.com/questions/5678432/decompressing-half-precision-floats-in-javascript
 */
const fromHalf = function(binary) {
   let exponent = (binary & 0x7C00) >> 10, 
       fraction = binary & 0x03FF;
   return (binary >> 15 ? -1 : 1) * 
           (exponent ? 
               (exponent === 0x1F ? (fraction ? NaN : Infinity) : Math.pow(2, exponent - 15) * (1 + fraction / 0x400)) 
               : 6.103515625e-5 * (fraction / 0x400)
            );
};


const createDataTexture3D = function(array, gl) {
   const uvs = [];
   const param = array[0].getTextureParameter();
   for (let uv of array) {
      uvs.push( uv.getBuffer() );
   }
   const tex = makeDataTexture3D(gl, uvs, param.internalFormat, param.format, param.type, uvs[0].length/param.channelCount);
   return tex;
}


const createDataTexture3DInt32 = function(array, gl) {
   const uvs = [];
   let temp;
   for (let uv of array) {
      temp = new Int32PixelArray(1, 1, uv.length);
      temp.allocEx(uv.length);
      temp._setValues(0, uv);
      uvs.push( temp.getBuffer() );
   }
   if (temp) {
      const param = temp.getTextureParameter();
      return makeDataTexture3D(gl, uvs, param.internalFormat, param.format, param.type, uvs[0].length/param.channelCount);
   }
   return null;
}


function rehydrate(obj) {
   if (obj.className == "Uint8PixelArray") {
      return Uint8PixelArray.rehydrate(obj);
   } else if (obj.className == "Int32PixelArray") {
      return Int32PixelArray.rehydrate(obj);
   } else if (obj.className == "Float32PixelArray") {
      return Float32PixelArray.rehydrate(obj);
   } else if (obj.className == "Float16PixelArray") {
      return Float16PixelArray.rehydrate(obj);
   } else if (obj.className == "Int32PixelArray3D") {
      return Int32PixelArray3D.rehydrate(obj);
   } else if (obj.className == "Float32PixelArray3D") {
      return Float32PixelArray3D.rehydrate(obj);
   } else if (obj.className == "Float16PixelArray3D") {
      return Float16PixelArray3D.rehydrate(obj);
   }
   // no matching class, should we throw?
   return null;
}



export {
   Uint8PixelArray,
   Int32PixelArray,
   Float32PixelArray,
   Float16PixelArray,
   Int32PixelArray3D,
   Float32PixelArray3D,
   Float16PixelArray3D,
   rehydrate,
   createDataTexture3D,
   createDataTexture3DInt32,
}
