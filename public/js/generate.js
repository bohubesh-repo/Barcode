async function refreshSkus() {
  const response = await fetch('/api/products');
  const skus = await response.json();
  const select = document.getElementById('skuSelect');
  const current = select.value;

  select.innerHTML = '<option value="">Select SKU</option>';
  skus.forEach(({ sku }) => {
    const option = document.createElement('option');
    option.value = sku;
    option.textContent = sku;
    if (sku === current) option.selected = true;
    select.appendChild(option);
  });
}

function showMessage(id, text) {
  document.getElementById(id).textContent = text;
}

document.getElementById('productForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());

  const response = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  showMessage('productMsg', body.detail || `Created SKU: ${body.sku}`);
  if (response.ok) {
    event.target.reset();
    refreshSkus();
  }
});

document.getElementById('batchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());

  const response = await fetch('/api/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  const actions = document.getElementById('batchActions');
  if (!response.ok) {
    showMessage('batchMsg', body.detail || 'Error creating batch');
    actions.innerHTML = '';
    return;
  }

  showMessage('batchMsg', `Batch ${body.batch_id} created. ENC_BATCH=${body.enc_batch}. Quantity=${body.quantity}`);
  actions.innerHTML = `
    <p class="small">Raw Batch (internal only): ${body.raw_batch_string}</p>
    <a class="btn secondary" href="/batch/${body.batch_id}/pdf">Download PDF Sheet</a>
  `;
  event.target.reset();
});

document.getElementById('lookupBtn').addEventListener('click', async () => {
  const barcode = document.getElementById('barcodeLookup').value.trim();
  const target = document.getElementById('lookupResult');

  if (!barcode) {
    target.textContent = 'Please enter barcode.';
    return;
  }

  const response = await fetch(`/api/units/${encodeURIComponent(barcode)}`);
  const body = await response.json();

  if (!response.ok) {
    target.textContent = body.detail || 'Not found';
    return;
  }

  target.innerHTML = `
    <p><strong>${body.full_barcode}</strong></p>
    <p>SKU: ${body.sku}</p>
    <p>Status: ${body.status}</p>
    <p><img src="/barcode/${body.id}.png" alt="barcode" /></p>
    <p><a href="/barcode/${body.id}.png" download>Download PNG</a></p>
  `;
});

refreshSkus();
