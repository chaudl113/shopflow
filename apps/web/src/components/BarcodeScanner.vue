<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Modal from '@/components/Modal.vue';

const emit = defineEmits<{ detected: [code: string]; close: [] }>();
const video = ref<HTMLVideoElement | null>(null);
const status = ref('Starting camera…');
let stream: MediaStream | null = null;
let stopped = false;
let stopZxing: (() => void) | null = null;

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

function done(code: string) {
  if (stopped) return;
  stopped = true;
  emit('detected', code);
}

onMounted(async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.value!.srcObject = stream;
    await video.value!.play();
    status.value = 'Point the camera at a barcode';

    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (BD) {
      // Native detector (Chrome, Edge, Android): no extra download.
      const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
      const tick = async () => {
        if (stopped || !video.value) return;
        const found = await detector.detect(video.value).catch(() => []);
        if (found[0]?.rawValue) done(found[0].rawValue);
        else requestAnimationFrame(tick);
      };
      tick();
    } else {
      // Safari/Firefox fallback, loaded only when needed.
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const controls = await new BrowserMultiFormatReader().decodeFromVideoElement(video.value!, (result) => {
        if (result) done(result.getText());
      });
      stopZxing = () => controls.stop();
    }
  } catch {
    status.value = 'Camera unavailable. Type the barcode or use a USB scanner instead.';
  }
});

onBeforeUnmount(() => {
  stopped = true;
  stopZxing?.();
  stream?.getTracks().forEach((t) => t.stop());
});
</script>

<template>
  <Modal title="Scan barcode" @close="emit('close')">
    <div class="relative overflow-hidden rounded-lg bg-slate-900">
      <video ref="video" class="aspect-video w-full object-cover" muted playsinline />
      <div class="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80" />
    </div>
    <p class="mt-3 text-center text-sm text-slate-500">{{ status }}</p>
  </Modal>
</template>
