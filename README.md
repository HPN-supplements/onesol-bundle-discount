# HPN Bundle Discount — Shopify Discount Function

> **Una sola vez**: esta app va en la carpeta `hpn-bundle-discount/` separada del theme.  
> No toca el theme. Solo vive en Shopify como una app instalada en la tienda.

---

## Qué hace

Al llegar al checkout, Shopify ejecuta esta función para cada carrito. La función:

1. Lee los **line_item attributes** de cada producto en el carrito.
2. Busca los que tienen `_bundle_item = "true"` (seteado por `bundle-builder-page.js`).
3. Lee el `_bundle_discount_pct` de cada línea (20, 25, o 30).
4. Aplica ese porcentaje **solo a esas líneas** — el resto del carrito queda intacto.

---

## Requisitos previos

- Node.js 22+
- Shopify CLI v3+ → `npm install -g @shopify/cli`
- Una cuenta en [Shopify Partners](https://partners.shopify.com)
- La tienda `hpn-supplements.myshopify.com` conectada a tu Partner account

---

## Setup paso a paso

### 1. Loguéate con Shopify CLI

```bash
cd hpn-bundle-discount
shopify auth login --store hpn-supplements.myshopify.com
```

### 2. Conecta o crea la app en tu Partner account

```bash
shopify app dev
```

La primera vez te preguntará si querés **crear una nueva app** o **conectar una existente**.  
→ Elegí **crear nueva app** y nómbrala "HPN Bundle Discount".  
El CLI completará `client_id` y `application_url` en `shopify.app.toml` automáticamente.

### 3. Instala la app en la tienda (development)

Mientras `shopify app dev` corre, el CLI te da una URL como:
```
https://xyz.trycloudflare.com
```
Abrila en el browser → instalá la app en `hpn-supplements.myshopify.com`.

### 4. Crea el Automatic Discount en Shopify Admin

Con `shopify app dev` corriendo, presioná **`g`** en la terminal para abrir GraphiQL.

Ejecutá esta mutación (reemplazá `YOUR_STORE` con `hpn-supplements.myshopify.com`):

```graphql
mutation {
  discountAutomaticAppCreate(
    automaticAppDiscount: {
      title: "Bundle Builder Discount"
      functionHandle: "hpn-bundle-discount"
      discountClasses: [PRODUCT]
      startsAt: "2026-01-01T00:00:00"
      combinesWith: {
        orderDiscounts: true
        productDiscounts: false
        shippingDiscounts: true
      }
    }
  ) {
    automaticAppDiscount {
      discountId
    }
    userErrors {
      field
      message
    }
  }
}
```

Si `userErrors` está vacío, el discount quedó activo. ✅

### 5. Verificá en Shopify Admin

Ve a **Discounts** → deberías ver **"Bundle Builder Discount"** activo con tipo **Automatic**.

### 6. Deploy a producción

Cuando estés listo para producción:

```bash
shopify app deploy
```

Esto publica la función a Shopify y reemplaza el draft de dev.

---

## Estructura de archivos

```
hpn-bundle-discount/
├── shopify.app.toml                          ← Config de la Shopify App
├── package.json
└── extensions/
    └── bundle-discount-function/
        ├── shopify.extension.toml            ← Config de la Function extension
        └── src/
            ├── run.graphql                   ← Input query (qué datos pide la función)
            └── run.js                        ← Lógica de la función (JavaScript)
```

---

## Cómo funciona el descuento con el theme

```
bundle-builder-page.js (theme)
  └── /cart/add.js con properties:
        _bundle_item         = "true"
        _bundle_id           = "bb-1234-abc"
        _bundle_discount_pct = "20"          ← según el tier activo

  → Cliente va a checkout

Shopify ejecuta run.js (esta función)
  └── Lee attributes de cada cart line
  └── Filtra los que tienen _bundle_item = "true"
  └── Lee _bundle_discount_pct = "20"
  └── Aplica 20% SOLO a esas líneas
  └── El resto del carrito → sin descuento ✅
```

---

## Tier de descuentos (configurado en el theme)

| Productos bundle en carrito | Descuento aplicado |
|---|---|
| 2 | 20% |
| 3 | 25% |
| 4 | 30% |

Estos porcentajes se setean en `bundle-builder-page.js` → `getCurrentTier()` y se pasan como `_bundle_discount_pct` en el momento del add to cart.

---

## Testing

```bash
# Correr la función localmente con un JSON de input de prueba
shopify app function run --input='{"cart":{"lines":[{"id":"gid://shopify/CartLine/1","quantity":1,"attributes":[{"key":"_bundle_item","value":"true"},{"key":"_bundle_discount_pct","value":"20"}],"cost":{"subtotalAmount":{"amount":"49.99","currencyCode":"USD"}}}]},"discount":{"discountClasses":["PRODUCT"]}}'
```

---

## Replay de ejecuciones reales

Mientras `shopify app dev` corre, cada checkout que use la función aparece en la terminal. Para replicar una ejecución localmente:

```bash
shopify app function replay
```

Seleccioná la ejecución de la lista → te muestra el input/output completo.
