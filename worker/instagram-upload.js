export const uploadScript = `
const form=document.querySelector('#instagram-image-form');
form.addEventListener('submit',async(event)=>{
 event.preventDefault();const input=document.querySelector('#image'),status=document.querySelector('#upload-status'),button=form.querySelector('button');
 const file=input.files[0];if(!file)return;
 button.disabled=true;status.textContent='Preparing your image…';
 try{
  if(file.size>20*1024*1024)throw Error('Please choose an image under 20 MB.');
  const bitmap=await createImageBitmap(file);const scale=Math.min(1,1440/bitmap.width,1440/bitmap.height);
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image conversion is unavailable in this browser. Please choose the JPEG download.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.94));
  if(!jpeg||jpeg.size>8*1024*1024)throw Error('The prepared image is too large. Please use the JPEG download.');
  status.textContent='Uploading JPEG…';const body=new FormData();body.set('image',jpeg,'instagram-artwork.jpg');
  const response=await fetch('/admin/instagram/images',{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'instagram-image-upload'},body});
  if(response.redirected){location.href=response.url;return;}
  if(!response.ok)throw Error('Image upload failed. Please sign in again if your session expired, then retry.');
  location.href='/admin/instagram';
 }catch(error){status.textContent=error.message||'Image preparation failed. Please choose the JPEG download.';button.disabled=false;}
});
`;
