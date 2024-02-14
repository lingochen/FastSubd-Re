[readme](../README.md)  | [roadmap](roadmap.md) | [api](api.md) | [reference](reference.md)

Consideration, Goal,

unify representation for rendering and editing. simple data structure, yet fast subdivision.

direct subdivision from editable mesh.

contiguous sequential array update, (performance)

DirectedEdge Array, (performance, easy update, subdivision)

use meshcolortexture/ptex/htex.

avoid false sharing

parallel implementation (gpu), [cpu](multithread.md)

wasm, (sharedtypearray is slow? )

rethink pull shader [pullShader](pullshader.md)

good name, [sane api](api.md)

[morton order(z-curve)](morton.md) of polygons, better spatial data locality/access.

Limitation/PitFall

directededge must be contiguous without hole or freed space. add another layer to solved it for editing purpose.

so we needs flexibility to handle the editing operation, and the underlying data can be optimized and contiguous at will.(@done, 2023/12)

nice to have?

hierarchical subdivision surface?


[UV TexCoord Attribute](uv_texcoord.md)

[PTex HTex](ptexhtex.md)

[HalfEdge Array](halfedge.md)

[DirectedEdge Array](directededge.md)

[Reference](reference.md)