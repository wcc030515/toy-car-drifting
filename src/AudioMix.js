// Calibrated maximum SFX level; the existing 0–100% sliders still scale linearly.
export const SFX_GAIN_BOOST=3.2;
export const REFERENCE_GAIN_BOOST=2;
// Pure Raceway's source is already healthy (-14.1 dBFS RMS). The previous
// maximum music gain of .09/.7 attenuated it by 17.8 dB before the master bus.
export const MUSIC_GAIN_AT_FULL=.5;

export function createAudioMix(ctx,{referenceOutput}={}){
 const master=ctx.createGain(),musicGain=ctx.createGain(),fxGain=ctx.createGain(),referenceGain=ctx.createGain();
 const musicCompressor=ctx.createDynamicsCompressor(),fxCompressor=ctx.createDynamicsCompressor(),fxLimiter=ctx.createDynamicsCompressor();
 // Keep the music's original signal path, gain and compressor settings.
 musicCompressor.threshold.value=-12;musicCompressor.knee.value=14;musicCompressor.ratio.value=5;musicCompressor.attack.value=.003;musicCompressor.release.value=.18;
 fxCompressor.threshold.value=-8;fxCompressor.knee.value=8;fxCompressor.ratio.value=4;fxCompressor.attack.value=.003;fxCompressor.release.value=.16;
 fxLimiter.threshold.value=-2;fxLimiter.knee.value=0;fxLimiter.ratio.value=20;fxLimiter.attack.value=0;fxLimiter.release.value=.09;
 master.gain.value=.85;musicGain.gain.value=0;fxGain.gain.value=.85*SFX_GAIN_BOOST;referenceGain.gain.value=REFERENCE_GAIN_BOOST;
 musicGain.connect(musicCompressor);musicCompressor.connect(master);
 fxGain.connect(fxCompressor);referenceGain.connect(fxCompressor);fxCompressor.connect(fxLimiter);fxLimiter.connect(master);master.connect(ctx.destination);
 if(referenceOutput){referenceOutput.disconnect();referenceOutput.connect(referenceGain);}
 return {master,musicGain,fxGain,referenceGain};
}
