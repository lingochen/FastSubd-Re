[design](design_note.md)

as of today (2024/01/14)

<s>with compact array representation, even with extra space, webworker finally got good speedup?</>

<s>so how to arrange memory is the key?</s> 

The above statements are untrue, somehow multithread just worked, is it the new chrome version? or did the various codes changed let us hit the fastpath?

use shared memory for distributing works, use atomic index to iterated. eliminated postmessage bottleneck if any. (Done, 2024/01/20), firefox has good performance improvement.

Cache alignment probably is the key. 