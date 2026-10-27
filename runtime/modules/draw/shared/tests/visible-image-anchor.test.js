import assert from 'node:assert/strict';
import test from 'node:test';
import {findUniqueVisibleAnchorEnd} from '../visible-image-anchor.js';

test('visible story anchor matches across several HTML text nodes',()=>{
    const runs=[{text:'Earlier paragraph. Alice walks '},{text:'into the room.'},{text:' Next plot beat.'}];
    const result=findUniqueVisibleAnchorEnd(runs,'Alice walks into the room.');
    assert.deepEqual(result,{run:1,end:'into the room.'.length});
});
test('Chinese quote in scene matches even with wrapped punctuation',()=>{
    const runs=[{text:'\u5979\u8f7b\u8f7b\u8d70\u5411\u7a97\u8fb9'},{text:'\uff0c\u62ac\u5934\u770b\u89c1\u9633\u5149\u3002'},{text:'\u65b0\u7684\u6bb5\u843d\u5f00\u59cb\u3002'}];
    const result=findUniqueVisibleAnchorEnd(runs,'\u5979\u8f7b\u8f7b\u8d70\u5411\u7a97\u8fb9\uff0c\u62ac\u5934\u770b\u89c1\u9633\u5149\u3002');
    assert.equal(result.run,1);
    assert.equal(result.end,runs[1].text.length);
});
test('no matching quote never returns a random position',()=>{
    assert.equal(findUniqueVisibleAnchorEnd([{text:'\u5979\u6cbf\u7740\u8d70\u5eca\u8d70\u5411\u697c\u68af\u3002'}],'\u5979\u6253\u5f00\u53e6\u4e00\u6247\u95e8\u3002'),null);
});
test('ambiguous repeated quote never chooses the wrong story paragraph',()=>{
    assert.equal(findUniqueVisibleAnchorEnd([{text:'Alice opens the door. Alice opens the door.'}],'Alice opens the door.'),null);
});
test('short generic snippets are not sufficient to re-anchor a generated image',()=>{
    assert.equal(findUniqueVisibleAnchorEnd([{text:'one, two, three, four'}],'one'),null);
});
