// Single-image source picker. No new persistent image storage.
function imageToDataUrl(imageInput) {
    return new Promise(async (resolve, reject) => {
        try {
            let source = imageInput;
            if (source instanceof Blob) {
                if (!/^image\/(?:png|jpeg|webp)$/i.test(source.type) || source.size > 15 * 1024 * 1024) {
                    throw new Error('只支持 15MB 以内的 PNG、JPG、WebP 图片');
                }
                source = URL.createObjectURL(source);
            }
            const img = new Image();
            img.onload = () => {
                try {
                    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                    const ctx = canvas.getContext('2d');
                    if (!ctx) throw new Error('无法读取图片画布');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.9));
                } catch (error) { reject(error); }
                finally { if (String(source).startsWith('blob:')) URL.revokeObjectURL(source); }
            };
            img.onerror = () => {
                if (String(source).startsWith('blob:')) URL.revokeObjectURL(source);
                reject(new Error('无法读取这张图片，可先保存到电脑再上传'));
            };
            img.crossOrigin = 'anonymous';
            img.src = String(source);
        } catch (error) { reject(error); }
    });
}

export function openImageCharacterSource({ listRecent, recognize }) {
    const doc = document;
    const duplicate = doc.getElementById('lwb-comfy-image-character-source');
    if (duplicate) { duplicate.querySelector('input[type=file]')?.focus(); return; }
    const overlay = doc.createElement('div');
    overlay.id = 'lwb-comfy-image-character-source';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.76);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
    const panel = doc.createElement('div');
    panel.style.cssText = 'width:min(720px,100%);max-height:calc(var(--vvh, 100vh) - 40px);overflow:auto;background:#202630;color:#ecf0f4;border:1px solid #4a5662;border-radius:12px;padding:18px;box-sizing:border-box';
    panel.style.maxHeight = 'calc(var(--vvh, 100vh) - 40px)';
    overlay.append(panel);
    const title = doc.createElement('h3'); title.textContent = '从图片生成角色';
    title.style.cssText='font-size:18px;margin:0 0 12px;color:#edca91';
    const desc = doc.createElement('p');
    desc.textContent='选择一张单人人像。AI 根据图片识别外貌、服装及表情，结果先用中文预览，确认后才保存。';
    desc.style.cssText='font-size:13px;line-height:1.7;color:#c8d0d9';
    const uploader = doc.createElement('input'); uploader.type='file';
    uploader.accept='image/png,image/jpeg,image/webp';
    uploader.style.cssText='display:block;width:100%;padding:12px 0';
    const image = doc.createElement('img'); image.alt='待识别的人物图片';
    image.style.cssText='display:none;max-width:100%;max-height:260px;object-fit:contain;border-radius:7px;margin:8px auto';
    const recentLabel = doc.createElement('p'); recentLabel.textContent='或者选择最近生成的图片：';
    recentLabel.style.cssText='font-size:13px;color:#bec9d3;margin:12px 0 7px';
    const recent = doc.createElement('div');recent.style.cssText='display:flex;gap:9px;overflow-x:auto;padding:6px 0;min-height:68px';
    const message = doc.createElement('p');message.textContent='等待选择图片';
    message.style.cssText='font-size:13px;color:#e6c99a;min-height:20px';
    const actions = doc.createElement('div');actions.style.cssText='display:flex;justify-content:flex-end;gap:10px';
    function button(label){const e=doc.createElement('button');e.type='button';e.textContent=label;e.style.cssText='background:#3a4452;color:white;border:1px solid #67727e;border-radius:6px;padding:8px 15px;cursor:pointer';return e;}
    const cancel=button('关闭'),submit=button('识图并生成角色');submit.style.background='#7b633e';
    submit.disabled=true;
    actions.append(cancel,submit);
    panel.append(title,desc,uploader,image,recentLabel,recent,message,actions);
    doc.body.append(overlay);
    let source=null,busy=false,finished=false;
    function selected(dataUrl) {
        source=dataUrl;
        image.src=dataUrl;
        image.style.display='block';
        submit.disabled=false;
        message.textContent='图片已选好，点击「识图并生成角色」';
    }
    uploader.addEventListener('change',async()=>{
        const file=uploader.files?.[0];if(!file)return;
        try{selected(await imageToDataUrl(file));}catch(e){message.textContent=e.message||'无法读取图片';}
    });
    cancel.addEventListener('click',()=>{if(busy)return;overlay.remove();});
    overlay.addEventListener('click',e=>{if(e.target===overlay&&!busy)overlay.remove();});
    submit.addEventListener('click',async()=>{
        if(!source||busy)return;
        busy=true;submit.disabled=true;cancel.disabled=true;
        message.textContent='正在调用视觉 AI 识别人物，请稍候...';
        try{
            await recognize(source,progress=>{message.textContent=progress;});
            finished=true;
            overlay.remove();
        }catch(e){
            message.textContent='识别失败：'+String(e?.message||e||'未知错误').slice(0,250);
        }finally{busy=false;cancel.disabled=false;submit.disabled=!source;}
    });
    void Promise.resolve().then(listRecent).then(images=>{
        if(!images?.length){recent.textContent='暂无可选图片，可使用上方上传';return;}
        for(const item of images.slice(0,12)){
            const b=button('');b.title='选择这张最近生成的图片';
            b.style.cssText='border:1px solid #566474;border-radius:6px;background:#303945;padding:3px;flex:0 0 92px;height:108px;cursor:pointer';
            const img=doc.createElement('img');img.src=item.displayUrl;img.alt='最近生成的图片';
            img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:4px';
            b.append(img);
            b.addEventListener('click',async()=>{
                if(busy)return;
                message.textContent='正在读取图库图片...';
                try{selected(await imageToDataUrl(item.sourceUrl||item.displayUrl));}
                catch(e){message.textContent='图库图片无法读取，请先保存到电脑再上传：'+e.message;}
            });
            recent.append(b);
        }
    }).catch(e=>{recent.textContent='图库暂时无法读取，可以直接上传图片';});
    return overlay;
}
