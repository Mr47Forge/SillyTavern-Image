import assert from 'node:assert/strict';
import test from 'node:test';
import {shouldUsePortableSavedImage} from '../saved-preview-selection.js';
const saved={imgId:'img-on-h28k',savedUrl:'/user/images/saved.png'};
test('stale browser selection must not mask a working H28K saved image',()=>{
    assert.equal(shouldUsePortableSavedImage(saved,{selectedImgId:'expired-id',hasData:false,isFailed:false}),true);
    assert.equal(shouldUsePortableSavedImage(saved,{selectedImgId:null,hasData:false,isFailed:false}),true);
});
test('a deliberate different successful gallery version remains selected',()=>{
    assert.equal(shouldUsePortableSavedImage(saved,{selectedImgId:'different',hasData:true,isFailed:false}),false);
});
test('an intentionally selected failed version retains the failure card',()=>{
    assert.equal(shouldUsePortableSavedImage(saved,{selectedImgId:'failed-version',hasData:false,isFailed:true}),false);
});
test('missing savedUrl must never invent a portable image',()=>{
    assert.equal(shouldUsePortableSavedImage({imgId:'img-on-h28k'},{hasData:false}),false);
});
