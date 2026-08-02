import * as nacl from 'tweetnacl';

export const secretbox = nacl.secretbox;
export const secretbox_open = nacl.secretbox.open;
export const sign = nacl.sign;
export const box = nacl.box;
export const box_open = nacl.box.open;
export const randomBytes = nacl.randomBytes;
