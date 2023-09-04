# Simple and Fast Subdivision
[Demo](https://rawcdn.githack.com/lingochen/FastSubd/2f0bc924c59b363ff22817e3b1b894efe9b7ce68/index.html).
require WebGL 2.

Any feedback, problem, remark or question about the code, file an issue or contact me at boeing.chen@gmail.com


## Screenshots
![Spot no subdivision](media/spot_subd0.png) ![Spot subdivision level 1](media/spot_subd1.png)


## Benefits
Simple to implemented and used.

Subdivision surface use tiny amount of data. Since compute improve faster than bandwidth for the forseeable future, we want to optimize for data size.

Perfectly suit for web based workflow.


## Implementation Info
Inspired by [A HalfEdge Refinement Rule for Parallel Catmull-Clark Subdivision](https://onrendering.com/) by Jonathan Dupuy, Kenneth Vanhoey

Major difference is that instead of using quad after one subdivision, we still use the same halfEdge representation for subdivision.

The same HalfEdge representation can be used for other subdivision schemes.

Loop and Modified Butterfly subdivision use an optimized triangle data structure, DirectedEdge, with same API as HalfEdge.


## Postmortem
Subdivision is memory access bound instead of compute bound. Rearrange data, use share data structure, and compress data to improve performance.

[OpenMesh](https://www.openmesh.org)'s subdivide is coventional because of it flexible kernel. Our implementation is more efficient and can be made more Parallel. However, subdivide is not the bottleneck, memory access is.

Use mesh shader or compute shader to expand data in chip to really improve performance.


## Roadmap
[Roadmap](docs/roadmap.md)
