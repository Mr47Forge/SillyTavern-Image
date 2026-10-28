import { getCurrentUserHandle } from '/scripts/user.js';

export function getImageCacheOwner() {
    const owner = String(getCurrentUserHandle() || '').trim();
    if (!owner) throw new Error('请先登录酒馆，再读取本地图片资料');
    return owner;
}

export function imageCacheDatabaseName(name, owner = getImageCacheOwner()) {
    return `${name}::${encodeURIComponent(owner)}`;
}

export function assertImageCacheOwner(owner) {
    if (getImageCacheOwner() !== owner) throw new Error('酒馆账号已切换，请重新打开图片或日志');
}
