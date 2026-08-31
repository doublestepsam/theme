/* Peak Line theme — global behaviors: cart drawer, quantity steppers,
   mobile nav toggle, variant swatches. Vanilla JS, no deps. */

document.addEventListener('DOMContentLoaded', function () {
  initMobileNav();
  initCartDrawer();
  initQtySteppers();
  initVariantPicker();
  initGalleryThumbs();
});

/* ---------------- Mobile nav ---------------- */
function initMobileNav() {
  var toggle = document.querySelector('[data-mobile-nav-toggle]');
  var nav = document.querySelector('[data-mobile-nav]');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', function () {
    var isOpen = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

/* ---------------- Cart drawer ---------------- */
function initCartDrawer() {
  var drawer = document.querySelector('[data-cart-drawer]');
  var overlay = document.querySelector('[data-cart-overlay]');
  if (!drawer || !overlay) return;

  function open() {
    drawer.classList.add('is-open');
    overlay.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
  }
  function close() {
    drawer.classList.remove('is-open');
    overlay.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-cart-open]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      if (drawer.dataset.cartType !== 'drawer') return; // let it navigate to /cart
      e.preventDefault();
      open();
    });
  });
  document.querySelectorAll('[data-cart-close]').forEach(function (btn) {
    btn.addEventListener('click', close);
  });
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  // Intercept "add to cart" forms to add via AJAX and open the drawer.
  document.querySelectorAll('form[data-product-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var pairItems = form.dataset.pairItems;
      var isDrawer = drawer.dataset.cartType === 'drawer';
      // A split pair is two line items, which a plain form post cannot do, so
      // those always go through fetch even when the cart is a page.
      if (!pairItems && !isDrawer) return; // normal submit -> cart page
      e.preventDefault();

      var request;
      if (pairItems) {
        var qtyInput = form.querySelector('[name="quantity"]');
        var quantity = parseInt(qtyInput && qtyInput.value, 10) || 1;
        var properties = JSON.parse(form.dataset.pairProperties || '{}');
        // Ties the two shoes together for picking and packing. The leading
        // underscore keeps it off the customer's order summary.
        properties._pair_id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        request = fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: JSON.parse(pairItems).map(function (id) {
              return { id: id, quantity: quantity, properties: properties };
            })
          })
        });
      } else {
        request = fetch('/cart/add.js', { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      }

      request
        .then(function (res) {
          if (!res.ok) throw new Error('Add to cart failed');
          return res.json();
        })
        .then(function () { return refreshCartDrawer(); })
        .then(function () {
          if (isDrawer) open();
          else window.location.href = '/cart';
        })
        .catch(function (err) { console.error('Add to cart failed', err); });
    });
  });
}

function refreshCartDrawer() {
  // The badge lives in the header section, so pull both: its count is
  // pair-aware and cannot be derived from the drawer markup alone.
  return fetch('/?sections=cart-drawer,header')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var temp = document.createElement('div');

      if (data['cart-drawer']) {
        temp.innerHTML = data['cart-drawer'];
        var newInner = temp.querySelector('[data-cart-drawer-inner]');
        var current = document.querySelector('[data-cart-drawer-inner]');
        if (newInner && current) current.innerHTML = newInner.innerHTML;
      }

      if (data['header']) {
        temp.innerHTML = data['header'];
        var newCartLink = temp.querySelector('[data-cart-open]');
        var cartLink = document.querySelector('[data-cart-open]');
        if (newCartLink && cartLink) cartLink.innerHTML = newCartLink.innerHTML;
      }

      initQtySteppers();
    });
}

/* ---------------- Quantity steppers (cart lines + product form) ---------------- */

// A cart row may stand for a split pair, in which case data-line-key holds both
// line keys and they have to move together or the cart is left half a pair.
function updateCartLines(lineKeys, quantity) {
  var updates = {};
  lineKeys.split(',').forEach(function (key) { updates[key] = quantity; });
  return fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: updates })
  }).then(refreshCartDrawer);
}

function initQtySteppers() {
  document.querySelectorAll('[data-qty-stepper]').forEach(function (stepper) {
    if (stepper.dataset.bound) return;
    stepper.dataset.bound = 'true';
    var input = stepper.querySelector('input');
    var minus = stepper.querySelector('[data-qty-minus]');
    var plus = stepper.querySelector('[data-qty-plus]');
    if (!input) return;

    function commit() {
      var keys = stepper.dataset.lineKey;
      if (!keys) return; // product-form stepper, no cart update needed
      updateCartLines(keys, parseInt(input.value || '0', 10))
        .catch(function (err) { console.error('Cart update failed', err); });
    }

    if (minus) minus.addEventListener('click', function () {
      input.value = Math.max(0, parseInt(input.value || '1', 10) - 1);
      commit();
    });
    if (plus) plus.addEventListener('click', function () {
      input.value = parseInt(input.value || '0', 10) + 1;
      commit();
    });
    input.addEventListener('change', commit);
  });

  document.querySelectorAll('[data-line-remove]').forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', function () {
      updateCartLines(btn.dataset.lineKey, 0)
        .catch(function (err) { console.error('Remove failed', err); });
    });
  });
}

/* ---------------- Variant picker (resolves the real variant from all
   selected options, and — for footwear — supports ordering a "split
   pair" with a different size per foot) ---------------------------- */
function initVariantPicker() {
  document.querySelectorAll('[data-product-form]').forEach(function (form) {
    var wrapper = form.closest('[data-product-info]') || form;
    var variantScript = wrapper.querySelector('[data-product-variants]');
    if (!variantScript) return;

    var variants;
    try {
      variants = JSON.parse(variantScript.textContent);
    } catch (e) {
      console.error('Could not parse product variants', e);
      return;
    }

    var pickers = Array.prototype.slice.call(form.querySelectorAll('[data-variant-picker]'));
    var idInput = form.querySelector('[data-variant-id-input]');
    var addBtn = form.querySelector('[data-add-to-cart-btn]');
    var addBtnText = form.querySelector('[data-add-to-cart-text]');
    var priceWrapper = wrapper.querySelector('[data-price-wrapper]');
    var priceEl = priceWrapper ? priceWrapper.querySelector('[data-price]') : null;
    var comparePriceEl = priceWrapper ? priceWrapper.querySelector('[data-compare-price]') : null;
    var saleBadgeEl = priceWrapper ? priceWrapper.querySelector('[data-sale-badge]') : null;

    var splitFields = form.querySelector('[data-split-fields]');
    var splitLeft = form.querySelector('[data-split-left]');
    var splitRight = form.querySelector('[data-split-right]');
    var splitAvailability = form.querySelector('[data-split-availability]');
    // Every Doublestep order is a split pair, so the size option is always
    // chosen as two independent selects rather than a single swatch picker.
    var isSplit = !!(splitFields && splitLeft && splitRight);
    var sizePos = isSplit ? parseInt(splitFields.dataset.optionPosition, 10) : null;
    // With a Side option each variant is one physical shoe, so the two sides
    // are added as two line items instead of one pair-priced variant.
    var sidePos = isSplit ? parseInt(splitFields.dataset.sidePosition, 10) || 0 : 0;

    // Current selection state, ordered by option position (1-indexed in Shopify variants).
    var selected = [];
    pickers.forEach(function (picker) {
      var pos = parseInt(picker.dataset.optionPosition, 10);
      var activeSwatch = picker.querySelector('.variant-swatch.is-selected') || picker.querySelector('.variant-swatch');
      selected[pos - 1] = activeSwatch ? activeSwatch.dataset.value : null;
    });

    function findVariant(optionValues) {
      return variants.find(function (v) {
        return optionValues.every(function (val, i) {
          var key = 'option' + (i + 1);
          return val == null || v[key] === val;
        });
      });
    }

    var galleryMain = (form.closest('.product-main') || document).querySelector('[data-gallery-main] img');

    // Variants only carry a featured_image once one is assigned to them in
    // the admin; without one the gallery just keeps whatever it is showing.
    function updateFeaturedImage(variant) {
      if (!galleryMain || !variant || !variant.featured_image) return;
      var src = variant.featured_image.src;
      galleryMain.src = src + (src.indexOf('?') === -1 ? '?' : '&') + 'width=1000';
      galleryMain.alt = variant.featured_image.alt || '';
    }

    function formatMoney(cents) {
      return '$' + (cents / 100).toFixed(2);
    }

    function updatePriceDisplay(variant) {
      if (!variant || !priceEl) return;
      if (variant.compare_at_price && variant.compare_at_price > variant.price) {
        priceEl.textContent = formatMoney(variant.price);
        priceEl.classList.add('price__sale');
        if (comparePriceEl) {
          comparePriceEl.textContent = formatMoney(variant.compare_at_price);
          comparePriceEl.hidden = false;
        }
        if (saleBadgeEl) saleBadgeEl.hidden = false;
      } else {
        priceEl.textContent = formatMoney(variant.price);
        priceEl.classList.remove('price__sale');
        if (comparePriceEl) comparePriceEl.hidden = true;
        if (saleBadgeEl) saleBadgeEl.hidden = true;
      }
    }

    function setAddButtonState(available, label) {
      if (!addBtn) return;
      addBtn.disabled = !available;
      if (addBtnText) addBtnText.textContent = label;
    }

    function removeSplitPropertyInputs() {
      form.querySelectorAll('[data-split-left-input], [data-split-right-input]').forEach(function (el) {
        el.remove();
      });
    }

    function setSplitPropertyInputs(leftValue, rightValue) {
      removeSplitPropertyInputs();
      var leftInput = document.createElement('input');
      leftInput.type = 'hidden';
      leftInput.name = 'properties[Left Shoe Size]';
      leftInput.value = leftValue;
      leftInput.setAttribute('data-split-left-input', '');
      var rightInput = document.createElement('input');
      rightInput.type = 'hidden';
      rightInput.name = 'properties[Right Shoe Size]';
      rightInput.value = rightValue;
      rightInput.setAttribute('data-split-right-input', '');
      form.appendChild(leftInput);
      form.appendChild(rightInput);
    }

    // ---- Normal (single-size) swatch selection ----
    function updateMainVariant() {
      var variant = findVariant(selected);
      if (!variant) {
        setAddButtonState(false, 'Unavailable');
        return;
      }
      if (idInput) idInput.value = variant.id;
      updatePriceDisplay(variant);
      updateFeaturedImage(variant);
      setAddButtonState(variant.available, variant.available ? 'Add to Cart' : 'Sold Out');
    }

    pickers.forEach(function (picker) {
      // Skip click-binding for the size picker while split mode is active;
      // handled separately so the two modes never fight over selection state.
      picker.querySelectorAll('[data-variant-value]').forEach(function (swatch) {
        swatch.addEventListener('click', function () {
          var pos = parseInt(picker.dataset.optionPosition, 10);
          picker.querySelectorAll('.variant-swatch').forEach(function (s) { s.classList.remove('is-selected'); });
          swatch.classList.add('is-selected');
          selected[pos - 1] = swatch.dataset.value;
          refresh();
        });
      });
    });

    // ---- Split-size (per-foot) selection ----
    // Both sides must be in stock. The line item is billed against the larger
    // of the two sizes' variants; the two sizes ride along as line-item
    // properties for fulfillment.
    function selectedSwatchValue(container) {
      var selectedSwatch = container.querySelector('.variant-swatch.is-selected');
      return selectedSwatch ? selectedSwatch.dataset.value : '';
    }

    function resetSplitState(message, isError) {
      setAddButtonState(false, 'Select both sizes');
      removeSplitPropertyInputs();
      delete form.dataset.pairItems;
      delete form.dataset.pairProperties;
      if (splitAvailability) {
        splitAvailability.textContent = message || '';
        splitAvailability.className = 'split-size-availability' + (isError ? ' is-error' : '');
      }
    }

    function evaluateSplitSelection() {
      var leftVal = selectedSwatchValue(splitLeft);
      var rightVal = selectedSwatchValue(splitRight);

      if (!leftVal || !rightVal) {
        // Colour is usually picked before sizes, so still swap the photo.
        updateFeaturedImage(findVariant(selected));
        resetSplitState('');
        return;
      }

      var leftOptions = selected.slice();
      leftOptions[sizePos - 1] = leftVal;
      var rightOptions = selected.slice();
      rightOptions[sizePos - 1] = rightVal;
      if (sidePos) {
        leftOptions[sidePos - 1] = 'Left';
        rightOptions[sidePos - 1] = 'Right';
      }

      var leftVariant = findVariant(leftOptions);
      var rightVariant = findVariant(rightOptions);

      var problems = [];
      if (!leftVariant || !leftVariant.available) problems.push('Left size ' + leftVal + ' is unavailable');
      if (!rightVariant || !rightVariant.available) problems.push('Right size ' + rightVal + ' is unavailable');

      if (problems.length) {
        resetSplitState(problems.join(' \u00b7 '), true);
        return;
      }

      if (sidePos) {
        // The left shoe carries the whole pair price; the right one is $0.
        form.dataset.pairItems = JSON.stringify([leftVariant.id, rightVariant.id]);
        form.dataset.pairProperties = JSON.stringify({
          'Left Shoe Size': leftVal,
          'Right Shoe Size': rightVal
        });
        removeSplitPropertyInputs();
        if (idInput) idInput.value = leftVariant.id;
        updatePriceDisplay(leftVariant);
        updateFeaturedImage(leftVariant);
      } else {
        // No Side option: one pair-priced variant, sizes recorded as properties.
        var leftNum = parseFloat(leftVal);
        var rightNum = parseFloat(rightVal);
        var billingVariant = leftVariant;
        if (!isNaN(leftNum) && !isNaN(rightNum) && rightNum > leftNum) billingVariant = rightVariant;
        if (idInput) idInput.value = billingVariant.id;
        updatePriceDisplay(billingVariant);
        updateFeaturedImage(billingVariant);
        setSplitPropertyInputs(leftVal, rightVal);
      }
      setAddButtonState(true, 'Add to Cart');

      if (splitAvailability) {
        splitAvailability.textContent = 'Both sizes in stock \u2014 ready to add.';
        splitAvailability.className = 'split-size-availability is-ok';
      }
    }

    function refresh() {
      if (isSplit) evaluateSplitSelection();
      else updateMainVariant();
    }

    if (isSplit) {
      [splitLeft, splitRight].forEach(function (container) {
        container.querySelectorAll('[data-variant-value]').forEach(function (swatch) {
          swatch.addEventListener('click', function () {
            container.querySelectorAll('.variant-swatch').forEach(function (other) {
              other.classList.remove('is-selected');
            });
            swatch.classList.add('is-selected');
            evaluateSplitSelection();
          });
        });
      });
    }

    // Initialize price/button state on load.
    refresh();
  });
}

/* ---------------- Product gallery thumbnails ---------------- */
function initGalleryThumbs() {
  document.querySelectorAll('[data-gallery]').forEach(function (gallery) {
    var main = gallery.querySelector('[data-gallery-main] img');
    gallery.querySelectorAll('[data-gallery-thumb]').forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        if (!main) return;
        main.src = thumb.dataset.fullSrc || thumb.src;
        gallery.querySelectorAll('[data-gallery-thumb]').forEach(function (t) {
          t.classList.remove('is-active');
        });
        thumb.classList.add('is-active');
      });
    });
  });
}
