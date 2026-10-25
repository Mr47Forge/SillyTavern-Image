'use strict';
const path = require('node:path');

// Only normalize directories supplied by SillyTavern authentication middleware.
// They are never taken from request parameters or a default user's directory.
function getCurrentUser(req) {
  const current = req.user;
  if (typeof current?.profile?.handle !== 'string' || !current.profile.handle) return null;
  const supplied = current.directories;
  const images = supplied?.userImages ?? supplied?.images;
  if (typeof images !== 'string' || !images.trim()) return null;
  const directories = { ...supplied, images: path.resolve(images) };
  if (typeof supplied.files === 'string' && supplied.files.trim()) directories.files = path.resolve(supplied.files);
  return { ...current, directories };
}
module.exports = { getCurrentUser };
