// Self-contained interaction for downloaded HTML. No React or network needed.
export const standaloneImageViewer = `<style>
.transcript-image-button{display:inline-block;padding:0;border:0;background:transparent;color:inherit;cursor:zoom-in;max-width:100%}
.transcript-image-button:focus-visible{outline:2px solid #00a969;outline-offset:4px;border-radius:8px}
#transcript-image-viewer{position:fixed;inset:0;width:calc(100vw - 32px);height:calc(100dvh - 32px);max-width:none;max-height:none;padding:0;border:1px solid #3c4645;border-radius:16px;background:#151b1a;color:#edf3ef;overflow:hidden}
#transcript-image-viewer::backdrop{background:rgb(8 14 12 / .85)}
#transcript-image-viewer header{display:flex;justify-content:flex-end;gap:8px;padding:12px;height:68px;box-sizing:border-box}
#transcript-image-viewer button{padding:8px 14px;min-height:40px;border:1px solid #52615c;border-radius:8px;background:#28322e;color:#edf3ef;font:inherit;cursor:pointer}
#transcript-image-viewer .image-stage{height:calc(100% - 68px);overflow:auto;display:flex;align-items:flex-start;padding:8px;box-sizing:border-box}
#transcript-image-viewer img{display:block;margin:auto;max-width:100%;max-height:100%;object-fit:contain}
#transcript-image-viewer[data-zoom="true"] img{max-width:none;max-height:none}
@media print{#transcript-image-viewer{display:none}}
</style>
<dialog id="transcript-image-viewer" aria-label="Image preview"><header><button type="button" data-image-zoom aria-pressed="false">Actual size</button><button type="button" data-image-close aria-label="Close image preview">Close</button></header><div class="image-stage"><img alt=""></div></dialog>
<script>
(()=>{
const dialog=document.getElementById('transcript-image-viewer'), image=dialog.querySelector('img'), zoom=dialog.querySelector('[data-image-zoom]');
let opener;
document.addEventListener('click',event=>{const button=event.target.closest('.transcript-image-button');if(!button)return;const source=button.querySelector('img');opener=button;image.src=source.src;image.alt=source.alt;dialog.dataset.zoom='false';zoom.textContent='Actual size';zoom.setAttribute('aria-pressed','false');dialog.showModal();});
dialog.querySelector('[data-image-close]').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
dialog.addEventListener('close',()=>{image.removeAttribute('src');if(opener)opener.focus();});
zoom.addEventListener('click',()=>{const enlarged=dialog.dataset.zoom!=='true';dialog.dataset.zoom=String(enlarged);zoom.textContent=enlarged?'Fit to window':'Actual size';zoom.setAttribute('aria-pressed',String(enlarged));});
})();
</script>`;
