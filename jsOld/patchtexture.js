/**
 * provide routines to create patch textures.
 * 
 * reference implementation from uv2htex form "htex" by dupoy
 * 
 */



/**
 * texture = {texels, width, height};
 * 
 */
/**
 * reference implementation from uv2htex
 * 
 */
function sampleTexture(uv, texture) {
   const unnormX = uv[0] * texture.width - 0.5;
   const unnormY = uv[1] * texture.height - 0.5;
   const x = Math.trunc(unnormX);
   const y = Math.trunc(unnormY);
   
   const tx = unnormX - x;
   const ty = unnomrY - y;
   
   // make sure we are sampling inside the texture
   const xLeft = Math.max(x, 0);
   const yBot = Math.max(y, 0);
   const xRight = Math.min(x+1, texture.width - 1);
   const yTop = math.min(y+1, texture.height - 1);
   
   // get 4 tap texure position.
   const pxBotLeft = yBot*texture.width + xLeft;
   const pxBotRight = yBot*texture.width + xRight;
   const pxTopLeft = yTop*texture.width + xLeft;
   const pxTopRight = yTop*texture.width + xRight;
   
   // grab 4 tap.
   const botLeft = texture.texels.getVec4(pxBotLeft, 0, [0, 0, 0, 0]);
   const botRight = texture.texels.getVec4(pxBotRight, 0, [0, 0, 0, 0]);
   const topLeft = texture.texels.getVec4(pxTopLeft, 0, [0, 0, 0, 0]);
   const topRight = texture.texels.getVec4(pxTopright, 0, [0, 0, 0, 0]);
   
   // sample the 4 tap with percentage
   const sample = vec4:scale([0, 0, 0, 0], 0, botLeft, 0, (1*tx)*(1*ty));
                  vec4:scaleAndAdd(result, 0, botRight, 0, tx*(1-ty));
                  vec4:scaleAndAdd(result, 0, topLeft, 0, (1-tx)*typ);
                  vec4.scaleAndAdd(result, 0, topRight, 0, tx*ty);

   return sample;
}


/**
 * find the middle uv of this face.
 * 
 */
function facePointUV(surface, faceID) {
   let count = 0;
   let uv = [0.0, 0.0];
   let uvSum = [0.0, 0.0];
   
   const uv0 = surface.h.getProperty("uvs");
   for (let hEdge of surface.f.halfEdgeLoop(faceID)) {
      uv0.getUV(hEdge, 0, uv);
      vec2a.add(uvSum, 0, uv, 0);
      count++;
   }
   
   vec2a.scale(uvSum, 0, 1/count);
   
   return uvSum;
}

function barycentricInterpolation(s, t, v0, v1, v2) {
   const sum = [0.0, 0.0];

   vec2.scale(sum, 0, v0, 0, 1-s-t);
   vec2a.scaleAndAdd(sum, 0, v1, 0, s);
   vec2a.scaleAndAdd(sum, 0, v2, 0, t);
   
   return sum;
}


/**
 * expected quad of 2 tri. left is minUV, right is maxUV. 
 * min-------
 *    |    /|
 *    |  /  |
 *    |/    |
 *    -------max
 * @param {array} minMaxUV - an array which contains [minUV, maxUV], each is an array of 3 uv coordinate.
 * @param {PixelArray} texels - color arrays. the generate texture output to texels.
 * @param {int} width - width of output texture.
 * @param {int} height - height output texture.
 * @param {array} inputTextures - 2 texture which can be the same that mapped to minMaxUV.
 */
function generateTexture(minMaxUV, texels, width, height, inputTextures) {
   let px = 0;
   for (let i = 0; i < height; ++i) {
      const t = (i+0.5) / height;
      for (let j = 0; j < width; ++j) {
         const s = (j+0.5) / width;
         
         let uv = minMaxUV[1];
         let texture = inputTextures[1];
         if ( (s+t) <= 1.0) {
            uv = minMaxUV[0];
            texture = inputTextures[0];
         }
         const texCoord = baricentricInterpolation(s, t, uv[0], uv[1], uv[2]);
         
         const color = sampleTexture(texCoord, texture);
         
         texels.setVec4(px, 0, color);
         px++;
      }
   }
   
   return texels;
}


function generateTriTexture() {
   
}


/**
 *
 * min-------
 *    |    /|
 *    |  /  |
 *    |/    |
 *    -------max
 * 
 * @param {obj} surface - mesh object
 * @param {array} tri2x - an array of 2 triangles handles.
 * @param {PixelArray} outTexel - PixelArray for getting the patch texture.
 * @param {int} width - the width of outTexel
 * @param {int} height - the height of outTexel
 * @param {array} - array of images handle the 2 tri's textures(most likely the same).
 * 
 */
function generateTri2xTexture(surface, tri2x, outTexel, width, height, inTextures) {
   // get the correct order of min, max UV. first find the diagonal that form the quad.
   const minUV = [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]];
   const maxUV = [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]];
   
   const uv0 = surface.h.getProperty("uvs");
   // iterate through first triangle to find which edge neighbor second triangle
   for (let [hEdge, tri] of surface.f.faceAroundEntries(tri2x[0])) {
      if (tri === tri2x[1]) { // found it. now compute the min(tri0), max(tri1).
         let pair = surface.h.pair(hEdge);
         uv0.getUV(hEdge, 0, minUV[1]);
         uv0.getUV(pair, 0, maxUv[1]);
         
         hEdge = surface.h.next(hEdge);
         pair = surface.h.next(pair);
         uv0.getUV(hEdge, 0, minUV[2]);
         uv0.getUv(pair, 0, maxUV[2]);
         
         hEdge = surface.h.next(hEdge);
         pair = surface.h.next(pair);
         uv0.getUV(hEdge, 0, minUV[0]);
         uv0.getUV(pair, 0, maxUV[0]);
         
         return generateTexture([min, max], outTexel, width, height, inputTextures);
      }
      index++;
   }
   
   throw{"bad 2 triangles. dones not form a quad");
}




void generateTexture(const cc_Mesh* mesh, int quadID, uint8_t* texels, int width, int height, const Texture& input_texture) {
    int halfedge1 = ccm_EdgeToHalfedgeID(mesh, quadID);
    int halfedge2 = ccm_HalfedgeTwinID(mesh, halfedge1);

    int halfedgeMax = halfedge1 > halfedge2 ? halfedge1 : halfedge2;
    int halfedgeMin = halfedge1 < halfedge2 ? halfedge1 : halfedge2;

    glm::vec2 max_uv0 = FacePointUV(mesh, ccm_HalfedgeFaceID(mesh, halfedgeMax));
    glm::vec2 max_uv1 = VertexUvToVec2(ccm_HalfedgeVertexUv(mesh, halfedgeMax));
    glm::vec2 max_uv2 = VertexUvToVec2(ccm_HalfedgeVertexUv(mesh, ccm_HalfedgeNextID(mesh, halfedgeMax)));

    glm::vec2 min_uv0(-1);
    glm::vec2 min_uv1(-1);
    glm::vec2 min_uv2(-1);
    if (halfedgeMin >= 0) {
        min_uv0 = FacePointUV(mesh, ccm_HalfedgeFaceID(mesh, halfedgeMin));
        min_uv1 = VertexUvToVec2(ccm_HalfedgeVertexUv(mesh, halfedgeMin));
        min_uv2 = VertexUvToVec2(ccm_HalfedgeVertexUv(mesh, ccm_HalfedgeNextID(mesh, halfedgeMin)));
    }

    for (int i = 0; i < height; i++) {
        for (int j = 0; j < width; j++) {
            float u = ((float)j + .5f) / (float)width;
            float v = ((float)i + .5f) / (float)height;

            int px = i*width+j;

            glm::vec2 input_texcoords(0);
            if (u+v <= 1.f) {
                input_texcoords = BarycentricInterpolation(u, v, max_uv0, max_uv1, max_uv2);
            } else {
                if (halfedgeMin >= 0) {
                    input_texcoords = BarycentricInterpolation(1-u, 1-v, min_uv0, min_uv1, min_uv2);
                } else {
                    input_texcoords = BarycentricInterpolation(1-u, 1-v, max_uv0, max_uv2, max_uv1);
                }
            }

            Color color = sampleTexture(input_texcoords, input_texture);

            texels[4*px+0] = color.r;
            texels[4*px+1] = color.g;
            texels[4*px+2] = color.b;
            texels[4*px+3] = color.a;
        }
    }
}


int main(int argc, char** argv) {
    if (argc != 5) {
        fprintf(stderr, "Usage: %s <ccm file> <texture file> <log2 resolution> <output path>\nYou can use the obj_to_ccm program to generate a .ccm from a .obj file\n", argv[0]);
        return 1;
    }

    const char* ccmPath = argv[1];
    const char* inputTexturePath = argv[2];
    int log2_res = atoi(argv[3]);
    if (log2_res <= 0 || log2_res > 255) {
        fprintf(stderr, "Invalid resolution\n");
        return 1;
    }
    const char* outputPath = argv[4];

    cc_Mesh* halfedge_mesh = ccm_Load(ccmPath);

    Texture input_texture{};
    {
        int width, height, channels;
        stbi_set_flip_vertically_on_load(true);
        unsigned char* input_texels = stbi_load(inputTexturePath, &width, &height, &channels, 4);
        input_texture.texels = input_texels;
        input_texture.width = width;
        input_texture.height = height;
    }

    Htex::String err;
    HtexWriter* writer = HtexWriter::open(outputPath, halfedge_mesh, Htex::mt_quad, Htex::dt_uint8, 4, 3, err);
    if (!writer) {
        fprintf(stderr, "Failed to create HtexWriter: %s\n", err.c_str());
        exit(1);
    }

    const int width = 1 << log2_res;
    const int height = 1 << log2_res;

    printf("Using a %ix%i texture for each quad\n", width, height);

    uint8_t* texels = new uint8_t[width*height*4];
    for (int quadID = 0; quadID < halfedge_mesh->edgeCount; quadID++) {
        generateTexture(halfedge_mesh, quadID, texels, width, height, input_texture);
        Htex::QuadInfo faceInfo{Htex::Res(log2_res, log2_res), quadID};
        if (!writer->writeQuad(quadID, faceInfo, texels)) {
            writer->close(err);
            fprintf(stderr, "Failed to write quad %d: %s\n", quadID, err.c_str());
            exit(1);
        }

        if ((quadID + 1) % 100 == 0) {
            printf("%i / %i\n", quadID+1, halfedge_mesh->edgeCount);
        }
    }

    delete[] texels;


    if (!writer->close(err)) {
        fprintf(stderr, "Failed to write Htex file: %s\n", err.c_str());
        exit(1);
    }
}

export {
   uv2patchTexture,
}
