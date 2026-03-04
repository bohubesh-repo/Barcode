const codeReader = new ZXing.BrowserMultiFormatReader();
let active = false;

function renderData(data) {
  return `
    <div class="small">
      <p><strong>${data.full_barcode}</strong></p>
      <p>SKU: ${data.sku}</p>
      <p>Category: ${data.category}</p>
      <p>Subcategory: ${data.subcategory}</p>
      <p>Model: ${data.model}</p>
      <p>Color: ${data.color}</p>
      <p>Size: ${data.size}</p>
      <p>ENC_BATCH: ${data.enc_batch}</p>
      <p>Raw Batch (internal): ${data.raw_batch_string}</p>
      <p>Serial: ${data.serial}</p>
      <p>Status: ${data.status}</p>
    </div>
  `;
}

async function fetchUnit(barcode) {
  const response = await fetch(`/api/units/${encodeURIComponent(barcode)}`);
  const body = await response.json();
  const message = document.getElementById('scanMsg');
  const result = document.getElementById('scanResult');

  if (!response.ok) {
    message.textContent = body.detail || 'Barcode not found';
    result.innerHTML = '';
    return;
  }

  message.textContent = 'Scan successful';
  result.innerHTML = renderData(body);
}

document.getElementById('startScan').addEventListener('click', async () => {
  if (active) return;
  active = true;
  document.getElementById('scanMsg').textContent = 'Camera active...';

  try {
    const devices = await codeReader.listVideoInputDevices();
    const preferredDevice = devices[devices.length - 1]?.deviceId;

    await codeReader.decodeFromVideoDevice(preferredDevice, 'reader', async (result, error) => {
      if (result) {
        codeReader.reset();
        active = false;
        await fetchUnit(result.getText());
      }

      if (error && !(error instanceof ZXing.NotFoundException)) {
        console.error(error);
      }
    });
  } catch (error) {
    document.getElementById('scanMsg').textContent = `Scanner error: ${error.message}`;
    active = false;
  }
});
