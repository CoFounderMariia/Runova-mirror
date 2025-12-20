# Простейшая база продуктов + логика рекомендаций.
# Для MVP — несколько примеров. Потом можно расширять.

PRODUCTS = {
    "cerave hydrating cleanser": {
        "type": "cleanser",
        "strength": "gentle",
        "actives": ["ceramides", "hyaluronic acid"],
        "avoid_if": [],
    },
    "the ordinary niacinamide 10%": {
        "type": "serum",
        "strength": "medium",
        "actives": ["niacinamide"],
        "avoid_if": [],
    },
    "the ordinary salicylic acid 2%": {
        "type": "serum",
        "strength": "strong",
        "actives": ["salicylic acid"],
        "avoid_if": ["high_redness", "barrier_damaged"],
    },
    "generic retinol 0.5%": {
        "type": "serum",
        "strength": "strong",
        "actives": ["retinol"],
        "avoid_if": ["high_redness", "barrier_damaged"],
    },
}


def recognize_product_from_text(text: str):
    """
    Очень простой матчинг: ищем ключ по подстроке.
    В реальном продукте можно сделать более умный поиск.
    """
    t = text.lower()
    for key in PRODUCTS.keys():
        if key in t:
            return key
    return None


def recommend_product_usage(product_key: str, skin_state: dict) -> str:
    p = PRODUCTS.get(product_key)
    if not p:
        return (
            "I couldn't confidently recognize this product yet. "
            "Use it according to the label and consult a dermatologist for medical questions."
        )

    messages = []

    messages.append(
        f"Product: {product_key.title()}. Type: {p['type']}, strength: {p['strength']}."
    )

    # skin_state — словарь из анализа кожи
    redness = skin_state.get("redness", 0.0)
    acne = skin_state.get("acne", 0.0)
    barrier_ok = skin_state.get("barrier_ok", True)

    flags = []
    if redness > 25:
        flags.append("high_redness")
    if not barrier_ok:
        flags.append("barrier_damaged")

    conflict = set(flags) & set(p.get("avoid_if", []))
    if conflict:
        messages.append(
            "⚠ Based on your current skin condition, this product should be used with caution or avoided today."
        )
    else:
        messages.append(
            "✅ This product is generally compatible with your current skin condition."
        )

    # Когда и как использовать
    if p["type"] == "cleanser":
        messages.append(
            "Use: 1–2 times per day as the first step of your routine on damp skin. "
            "Massage for 30–60 seconds, then rinse with lukewarm water."
        )
    elif p["type"] == "serum":
        messages.append(
            "Use: after cleansing, on dry skin. Apply a thin layer, then wait 1–2 minutes before moisturizer."
        )
    elif p["type"] == "moisturizer":
        messages.append(
            "Use: after serums, on slightly damp skin, 1–2 times per day."
        )
    elif p["type"] == "sunscreen":
        messages.append(
            "Use: in the morning as the last step of your routine, 15 minutes before sun exposure, "
            "and reapply every 2 hours when in the sun."
        )

    actives = p.get("actives", [])
    if "salicylic acid" in actives:
        messages.append(
            "Note: Salicylic acid (BHA) helps with clogged pores and acne. "
            "Avoid combining with strong retinoids and other strong acids in the same routine if your skin is sensitive."
        )
    if "retinol" in actives:
        messages.append(
            "Note: Retinol can improve texture and acne but may irritate. "
            "Use only at night, start 2–3 times a week, avoid mixing with strong acids and always use sunscreen in the morning."
        )
    if "ceramides" in actives:
        messages.append(
            "Note: Ceramides support the skin barrier. Good choice when skin feels dry or irritated."
        )
    if "hyaluronic acid" in actives:
        messages.append(
            "Note: Hyaluronic acid should be applied on slightly damp skin and sealed with a moisturizer to avoid dehydration."
        )
    if "niacinamide" in actives:
        messages.append(
            "Note: Niacinamide can help with redness, uneven tone, and barrier support. "
            "Usually well-tolerated even by sensitive skin."
        )

    return "\n".join(messages)