import assert from 'node:assert/strict';
import test from 'node:test';
import {isUnclaimedImageSlot} from '../image-slot-validity.js';

test('unowned phantom slot is not a generated or failed image',()=>{
    assert.equal(isUnclaimedImageSlot({displayData:{hasData:false,isFailed:false}}),true);
});
test('H28K saved image always stays visible',()=>{
    assert.equal(isUnclaimedImageSlot({savedEntry:{savedUrl:'/user/images/test.png'},displayData:{hasData:false}}),false);
});
test('new image generating or queued is not suppressed',()=>{
    assert.equal(isUnclaimedImageSlot({activity:{index:3,total:4}}),false);
    assert.equal(isUnclaimedImageSlot({pendingSlot:{slotId:'slot-real'}}),false);
    assert.equal(isUnclaimedImageSlot({displayData:{hasData:true}}),false);
});
test('real failed image should retain its retry controls',()=>{
    assert.equal(isUnclaimedImageSlot({displayData:{hasData:false,isFailed:true}}),false);
});
