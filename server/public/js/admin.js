function resetServiceIconUI(iconUrl) {
  const preview = document.getElementById('serviceIconPreview');
  const removeBtn = document.getElementById('removeIconBtn');
  const urlInput = document.getElementById('serviceIconUrl');
  const fileInput = document.getElementById('serviceIconFile');
  const status = document.getElementById('iconUploadStatus');

  fileInput.value = '';
  status.textContent = '';

  if (urlInput) {
    urlInput.value = iconUrl || '';
  }

  if (iconUrl) {
    preview.src = iconUrl;
    preview.style.display = 'block';
    removeBtn.style.display = 'inline-block';
  } else {
    preview.src = '';
    preview.style.display = 'none';
    removeBtn.style.display = 'none';
  }
}


// ================================
// Upload local logo
// ================================

document.getElementById('uploadIconBtn').addEventListener('click', () => {
  document.getElementById('serviceIconFile').click();
});


// Preview local file
document.getElementById('serviceIconFile').addEventListener('change', (e) => {
  const file = e.target.files[0];

  if (!file) return;

  const preview = document.getElementById('serviceIconPreview');

  const reader = new FileReader();

  reader.onload = (ev) => {
    preview.src = ev.target.result;
    preview.style.display = 'block';

    document.getElementById('iconUploadStatus').textContent =
      `Ready to upload: ${file.name}`;

    // If local file is selected, clear Cloudinary URL
    document.getElementById('serviceIconUrl').value = '';
  };

  reader.readAsDataURL(file);
});


// ================================
// Preview Cloudinary URL
// ================================

document.getElementById('serviceIconUrl').addEventListener('input', (e) => {
  const url = e.target.value.trim();

  const preview = document.getElementById('serviceIconPreview');
  const removeBtn = document.getElementById('removeIconBtn');

  // If empty, hide preview
  if (!url) {
    preview.src = '';
    preview.style.display = 'none';
    removeBtn.style.display = 'none';
    return;
  }

  // Only try to preview valid HTTP/HTTPS URLs
  if (url.startsWith('http://') || url.startsWith('https://')) {
    preview.src = url;
    preview.style.display = 'block';
    removeBtn.style.display = 'inline-block';

    document.getElementById('iconUploadStatus').textContent =
      'Cloudinary URL';
  }
});


// ================================
// Remove logo
// ================================

document.getElementById('removeIconBtn').addEventListener('click', async () => {
  const id = document.getElementById('serviceId').value;

  // Clear UI immediately
  document.getElementById('serviceIconUrl').value = '';
  resetServiceIconUI(null);

  // If this service already exists, remove icon_url from database
  if (id) {
    try {
      const res = await fetch(`/api/services/${id}/upload-icon`, {
        method: 'DELETE'
      });

      const json = await res.json();

      if (!json.success) {
        showToast(json.error || 'Failed to remove logo', 'error');
        return;
      }

      showToast('Logo removed');
      loadServices();

    } catch (error) {
      console.error(error);
      showToast('Failed to remove logo', 'error');
    }
  }
});


// ================================
// ADD SERVICE
// ================================

document.getElementById('addServiceBtn').addEventListener('click', () => {

  document.getElementById('serviceModalTitle').textContent = 'Add Service';

  document.getElementById('serviceId').value = '';

  document.getElementById('serviceName').value = '';

  document.getElementById('serviceDomain').value = '';

  document.getElementById('serviceIcon').value = '';

  document.getElementById('serviceCategory').value = 'productivity';

  document.getElementById('serviceIconUrl').value = '';

  resetServiceIconUI(null);

  populateParentDropdown(null);

  document.getElementById('serviceParent').value = '';

  openModal('serviceModal');
});


// ================================
// EDIT SERVICE
// ================================

window.editService = async function(id) {

  const s = servicesCache.find(x => x.id === id);

  if (!s) return;

  document.getElementById('serviceModalTitle').textContent = 'Edit Service';

  document.getElementById('serviceId').value = s.id;

  document.getElementById('serviceName').value = s.name;

  document.getElementById('serviceDomain').value = s.domain;

  document.getElementById('serviceIcon').value = s.icon || '';

  document.getElementById('serviceCategory').value = s.category;

  // Load existing Cloudinary URL
  document.getElementById('serviceIconUrl').value = s.icon_url || '';

  resetServiceIconUI(s.icon_url || null);

  populateParentDropdown(s.id);

  document.getElementById('serviceParent').value =
    s.parent_id || '';

  openModal('serviceModal');
};


// ================================
// SAVE SERVICE
// ================================

document.getElementById('saveServiceBtn').addEventListener('click', async () => {

  const id = document.getElementById('serviceId').value;

  const parentVal =
    document.getElementById('serviceParent').value;

  const cloudinaryUrl =
    document.getElementById('serviceIconUrl').value.trim();

  const data = {
    name: document.getElementById('serviceName').value.trim(),

    domain: document.getElementById('serviceDomain').value.trim(),

    icon:
      document.getElementById('serviceIcon').value.trim()
      || '🌐',

    category:
      document.getElementById('serviceCategory').value,

    enabled: true,

    parent_id:
      parentVal ? parseInt(parentVal) : null,

    // IMPORTANT
    icon_url: cloudinaryUrl || null
  };

  // Validate
  if (!data.name || !data.domain) {
    showToast(
      'Name and domain are required',
      'error'
    );
    return;
  }

  let serviceId = id;

  // ================================
  // Update existing service
  // ================================

  if (id) {

    const result =
      await API.put(
        `/api/services/${id}`,
        data
      );

    if (!result || !result.success) {
      showToast(
        result?.error || 'Failed to update service',
        'error'
      );
      return;
    }

  }

  // ================================
  // Create new service
  // ================================

  else {

    const res =
      await API.post(
        '/api/services',
        data
      );

    if (!res || !res.success) {
      showToast(
        res?.error || 'Failed to create service',
        'error'
      );
      return;
    }

    serviceId = res.id;
  }


  // ================================
  // Local file upload
  // ================================
  //
  // If user selected a local file,
  // it takes priority over Cloudinary URL.
  //

  const fileInput =
    document.getElementById('serviceIconFile');

  if (
    fileInput.files.length > 0 &&
    serviceId
  ) {

    const formData = new FormData();

    formData.append(
      'icon',
      fileInput.files[0]
    );

    try {

      const uploadRes =
        await fetch(
          `/api/services/${serviceId}/upload-icon`,
          {
            method: 'POST',
            body: formData
          }
        );

      const uploadJson =
        await uploadRes.json();

      if (!uploadJson.success) {

        showToast(
          'Icon upload failed: ' +
          (uploadJson.error || 'Unknown error'),
          'error'
        );

        return;
      }

    } catch (error) {

      console.error(error);

      showToast(
        'Icon upload failed',
        'error'
      );

      return;
    }
  }


  showToast(
    id
      ? 'Service updated'
      : 'Service added'
  );

  closeModal('serviceModal');

  loadServices();
});