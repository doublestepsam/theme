/* Peak Line theme — global behaviors: cart drawer, quantity steppers,
   mobile nav toggle, variant swatches, quick add. Vanilla JS, no deps. */

document.addEventListener('DOMContentLoaded', function () {
  initMobileNav();
  initCartDrawer();
  initQtySteppers();
  initVariantPicker();
  initQuickAdd();
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
      if (drawer.dataset.cartType !== 'drawer') return; // normal submit -> cart page
      e.preventDefault();
      var formData = new FormData(form);
      fetch('/cart/add.js', { method: 'POST', body: formData, headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function () { return refreshCartDrawer(); })
        .then(open)
        .catch(function (err) { console.error('Add to cart failed', err); });
    });
  });
}

function refreshCartDrawer() {
  return fetch('/?sections=cart-drawer')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var html = data['cart-drawer'];
      if (!html) return;
      var temp = document.createElement('div');
      temp.innerHTML = html;
      var newInner = temp.querySelector('[data-cart-drawer-inner]');
      var current = document.querySelector('[data-cart-drawer-inner]');
      if (newInner && current) current.innerHTML = newInner.innerHTML;
      var newCount = temp.querySelector('[data-cart-count]');
      document.querySelectorAll('[data-cart-count]').forEach(function (el) {
        if (newCount) el.textContent = newCount.textContent;
      });
      initQtySteppers();
    });
}

/* ---------------- Quantity steppers (cart lines + product form) ---------------- */
function initQtySteppers() {
  document.querySelectorAll('[data-qty-stepper]').forEach(function (stepper) {
    if (stepper.dataset.bound) return;
    stepper.dataset.bound = 'true';
    var input = stepper.querySelector('input');
    var minus = stepper.querySelector('[data-qty-minus]');
    var plus = stepper.querySelector('[data-qty-plus]');
    if (!input) return;

    function commit() {
      var key = stepper.dataset.lineKey;
      if (!key) return; // product-form stepper, no cart update needed
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key, quantity: parseInt(input.value || '0', 10) })
      })
        .then(function () { return refreshCartDrawer(); })
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
    btn.addEventListener('click', function () {
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: btn.dataset.lineKey, quantity: 0 })
      })
        .then(function () { return refreshCartDrawer(); })
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
    var sizePicker = form.querySelector('[data-size-picker]');
    var idInput = form.querySelector('[data-variant-id-input]');
    var addBtn = form.querySelector('[data-add-to-cart-btn]');
    var addBtnText = form.querySelector('[data-add-to-cart-text]');
    var priceWrapper = wrapper.querySelector('[data-price-wrapper]');
    var priceEl = priceWrapper ? priceWrapper.querySelector('[data-price]') : null;
    var comparePriceEl = priceWrapper ? priceWrapper.querySelector('[data-compare-price]') : null;
    var saleBadgeEl = priceWrapper ? priceWrapper.querySelector('[data-sale-badge]') : null;

    var splitToggle = form.querySelector('[data-split-toggle]');
    var splitFields = form.querySelector('[data-split-fields]');
    var splitLeft = form.querySelector('[data-split-left]');
    var splitRight = form.querySelector('[data-split-right]');
    var splitAvailability = form.querySelector('[data-split-availability]');
    var splitBreakdown = form.querySelector('[data-split-price-breakdown]');
    var premiumBadge = priceWrapper ? priceWrapper.querySelector('[data-premium-badge]') : null;

    var premiumOptionName = form.dataset.premiumOptionName;
    var premiumOptionValue = form.dataset.premiumOptionValue;
    var premiumPicker = pickers.find(function (p) {
      return premiumOptionName && p.dataset.optionName &&
        p.dataset.optionName.toLowerCase() === premiumOptionName.toLowerCase();
    });
    var premiumPos = premiumPicker ? parseInt(premiumPicker.dataset.optionPosition, 10) : null;

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
      if (premiumBadge) premiumBadge.hidden = true;
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
      setAddButtonState(variant.available, variant.available ? 'Add to Cart' : 'Sold Out');
    }

    pickers.forEach(function (picker) {
      // Skip click-binding for the size picker while split mode is active;
      // handled separately so the two modes never fight over selection state.
      picker.querySelectorAll('[data-variant-value]').forEach(function (swatch) {
        swatch.addEventListener('click', function () {
          if (splitToggle && splitToggle.checked && picker === sizePicker) return;
          var pos = parseInt(picker.dataset.optionPosition, 10);
          picker.querySelectorAll('.variant-swatch').forEach(function (s) { s.classList.remove('is-selected'); });
          swatch.classList.add('is-selected');
          selected[pos - 1] = swatch.dataset.value;
          updateMainVariant();
        });
      });
    });

    // ---- Split-size (per-foot) selection ----
    // Stock truth lives on the "standard" variants; the real charge always
    // comes from the premium-value variant's own price (never computed
    // client-side), so the customer is only ever charged what checkout will
    // actually collect.
    if (splitToggle && sizePicker && splitFields) {
      splitToggle.addEventListener('change', function () {
        if (splitToggle.checked) {
          sizePicker.hidden = true;
          splitFields.hidden = false;
          removeSplitPropertyInputs();
          setAddButtonState(false, 'Select both sizes');
        } else {
          sizePicker.hidden = false;
          splitFields.hidden = true;
          removeSplitPropertyInputs();
          if (splitAvailability) {
            splitAvailability.textContent = '';
            splitAvailability.className = 'split-size-availability';
          }
          if (splitBreakdown) splitBreakdown.hidden = true;
          updateMainVariant();
        }
      });

      function resetSplitState(message, isError) {
        setAddButtonState(false, 'Select both sizes');
        removeSplitPropertyInputs();
        if (splitBreakdown) splitBreakdown.hidden = true;
        if (splitAvailability) {
          splitAvailability.textContent = message || '';
          splitAvailability.className = 'split-size-availability' + (isError ? ' is-error' : '');
        }
      }

      function evaluateSplitSelection() {
        var leftVal = splitLeft.value;
        var rightVal = splitRight.value;

        if (!leftVal || !rightVal) {
          resetSplitState('');
          return;
        }

        if (!premiumPicker || premiumPos == null) {
          resetSplitState('Split-size pricing isn\'t set up for this product yet — please contact us to order this combination.', true);
          return;
        }

        var sizePos = parseInt(sizePicker.dataset.optionPosition, 10);

        // Real stock truth: the standard (non-premium) variant of each side.
        var leftStandardOptions = selected.slice();
        leftStandardOptions[sizePos - 1] = leftVal;
        var rightStandardOptions = selected.slice();
        rightStandardOptions[sizePos - 1] = rightVal;

        var leftStandardVariant = findVariant(leftStandardOptions);
        var rightStandardVariant = findVariant(rightStandardOptions);

        var problems = [];
        if (!leftStandardVariant || !leftStandardVariant.available) problems.push('Left size ' + leftVal + ' is unavailable');
        if (!rightStandardVariant || !rightStandardVariant.available) problems.push('Right size ' + rightVal + ' is unavailable');

        if (problems.length) {
          resetSplitState(problems.join(' · '), true);
          return;
        }

        // Bill against the larger of the two sizes — common convention for
        // split-pair orders — using the real premium-priced variant.
        var leftNum = parseFloat(leftVal);
        var rightNum = parseFloat(rightVal);
        var billSide = 'left';
        if (!isNaN(leftNum) && !isNaN(rightNum) && rightNum > leftNum) billSide = 'right';
        var billingSizeValue = billSide === 'right' ? rightVal : leftVal;
        var standardBillingVariant = billSide === 'right' ? rightStandardVariant : leftStandardVariant;

        var premiumOptions = selected.slice();
        premiumOptions[sizePos - 1] = billingSizeValue;
        premiumOptions[premiumPos - 1] = premiumOptionValue;
        var premiumVariant = findVariant(premiumOptions);

        if (!premiumVariant) {
          resetSplitState('Split-size pricing isn\'t set up for size ' + billingSizeValue + ' yet — please contact us to order this combination.', true);
          return;
        }
        if (!premiumVariant.available) {
          resetSplitState('Split-size ordering isn\'t available for size ' + billingSizeValue + ' right now.', true);
          return;
        }

        if (idInput) idInput.value = premiumVariant.id;
        updatePriceDisplay(premiumVariant);
        if (premiumBadge) premiumBadge.hidden = false;
        setSplitPropertyInputs(leftVal, rightVal);
        setAddButtonState(true, 'Add Split Pair to Cart');

        if (splitBreakdown) {
          splitBreakdown.hidden = false;
          splitBreakdown.textContent = 'Standard size ' + billingSizeValue + ': ' + formatMoney(standardBillingVariant.price) +
            ' → Split-size price: ' + formatMoney(premiumVariant.price);
        }
        if (splitAvailability) {
          splitAvailability.textContent = 'Both sizes in stock — ready to add.';
          splitAvailability.className = 'split-size-availability is-ok';
        }
      }

      splitLeft.addEventListener('change', evaluateSplitSelection);
      splitRight.addEventListener('change', evaluateSplitSelection);
    }

    // Initialize price/button state on load.
    updateMainVariant();
  });
}

/* ---------------- Quick add from product cards ---------------- */
function initQuickAdd() {
  document.querySelectorAll('[data-quick-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var variantId = btn.dataset.variantId;
      if (!variantId) return;
      btn.disabled = true;
      var original = btn.textContent;
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: variantId, quantity: 1 })
      })
        .then(function (res) { return res.json(); })
        .then(function () { return refreshCartDrawer(); })
        .then(function () {
          var drawer = document.querySelector('[data-cart-drawer]');
          var overlay = document.querySelector('[data-cart-overlay]');
          if (drawer && overlay && drawer.dataset.cartType === 'drawer') {
            drawer.classList.add('is-open');
            overlay.classList.add('is-open');
          }
          btn.textContent = 'Added';
          setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 1200);
        })
        .catch(function (err) {
          console.error('Quick add failed', err);
          btn.disabled = false;
        });
    });
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
