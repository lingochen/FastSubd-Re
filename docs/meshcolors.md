[readme](../README.md) | [roadmap](roadmap.md) | [design](design_note.md) | [api](api.md) | [reference](reference.md)

Although [Htex](https://onrendering.com/) by Jonathan Dupuy is elegant for Catmull-Clark Surface, but we also want to support Triangle Subdivision Scheme, which doesn't seems to be a good fit for Htex.

[Mesh Colors](http://www.cemyuksel.com/research/meshcolors/) by Cem Yuksel, or rather some variations of the Patch Texture, seems to works well with both quad/tri scheme. So we will tried Mesh Colors.

We don't want uv coordinate because of seam and duplicate vertex problems.

Mesh Color Patch Texture give us. (According to Cem Yuksel)

- No mapping! (implicit uv mapping)
- Local resolution readjustment
- Model editing after painting!
- No seams!
- Correct mip-maps
- Correct anisotropic filtering

uv mapping is one of the most wasteful time sinks in asset creation.  No mapping alone is worth the implementation costs.

Implementation detail

tried to fit 2 triangle together to form a quad then map the quad to patch texture.
fit one triangle to one patch texture if no good pair of triangle is founded.
quadrangulation should be simple. Round the triangle pair with the best shape, which is as rectangle as possible, minimized slanting.

triangle index to each Mesh Colors Patch.

Implementation Steps:

quad-forming
<s>color material color working. shader code needed too.</s> @done(2024/03/12)

<s>triangles in checkbox color pattern, so we can see triangles?</s> @done (2024/03/12)

<s>pair triangles to form quad.</s> @done (2024/03/18)

<s>quads in checkbox color pattern, so we can see quad pairing.</s> @done (2024/03/16), @redone(2024/03/29), new method.

texture-packing

compute the size of each quad/tri patch occupy. 

binned quad/tri to sizes.

render quad/tri to texture. packs and bins to one big texture.

render mip-mapped textures. packs each level to one texture.

show the packed textures.

finally, render model with the new Mesh Colors Patch Texture.