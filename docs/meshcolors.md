[readme](../README.md) | [roadmap](roadmap.md) | [design](design_note.md) | [api](api.md) | [reference](reference.md)

Although [Htex](https://onrendering.com/) by Jonathan Dupuy is elegant for Catmull-Clark Surface, but we also want to support Triangle Subdivision Scheme, which doesn't seems to be a good fit for Htex.

[Mesh Colors](http://www.cemyuksel.com/research/meshcolors/) by Cem Yuksel, or rather some variations of the Patch Texture, seems to works well with both quad/tri scheme. So we will tried Mesh Colors.

We don't want uv coordinate because of seam and duplicate vertex problems.

Mesh Colors with bindless textures give us. (According to Cem Yuksel)

- No mapping! (implicit uv mapping)
- Local resolution readjustment
- Model editing after painting!
- No seams!
- Correct mip-maps
- Correct anisotropic filtering

uv mapping is one of the most wasteful time sinks in asset creation.  No mapping alone is worth the implementation costs.

Implementation detail

tried to fit 2 triangle together as a quad if the texture is continuous. map one quad to patch texture.
fit one triangle to one patch texture if no friend triangle is founded.

triangle face index to patch texture's left or right triangle patch. (odd number to left, even number to right).