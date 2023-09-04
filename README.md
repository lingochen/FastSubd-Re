# Simple and Fast Subdivision
<s>[Demo](https://rawcdn.githack.com/lingochen/FastSubd/2f0bc924c59b363ff22817e3b1b894efe9b7ce68/index.html).</s>
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

Major difference is that instead of using quad after one subdivision, we use the same DirectedEdge representation for subdivision.

[design_note](docs/design_note.md)

[api](docs/api.md)

[reference](docs/referenc.md)

## Roadmap
[Roadmap](docs/roadmap.md)
