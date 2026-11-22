// A Cloud credit-hour is 320 kbps for one listener for one hour (144 MB).
// Rates describe audio payload, excluding transport and encryption overhead.
export const cloudBaselineBitrate=320000;
export const cloudBytesPerCreditHour=144000000;
export function cloudFormat(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Update SessionStream to use data-based Cloud credits.');
 const {codec,channels,bitDepth,bitrate,sampleRate}=value;
 if(![1,2,6,8].includes(channels))throw Error('Invalid Cloud channel layout.');
 if(codec==='opus'){
  if(channels>2||![96000,128000,192000,256000,320000,510000].includes(bitrate)||sampleRate!==48000)throw Error('Invalid Cloud Opus format.');
  return {codec,channels,bitrate,sampleRate,bitDepth:16};
 }
 if(codec!=='pcm'||![16,24,32].includes(bitDepth)||![44100,48000,88200,96000,176400,192000].includes(sampleRate))throw Error('Invalid Cloud PCM format.');
 return {codec,channels,bitDepth,sampleRate,bitrate:0};
}
export function cloudBitrate(format){const f=cloudFormat(format);return f.codec==='opus'?f.bitrate:f.sampleRate*f.channels*f.bitDepth;}
export function cloudCreditRate(format){return cloudBitrate(format)/cloudBaselineBitrate;}
