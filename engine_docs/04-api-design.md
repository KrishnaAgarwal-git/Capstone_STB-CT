# Personalised Carbon Recommendation Engine
## Part 4 — API Design

All endpoints are versioned under `/api/v1`. Auth via bearer JWT (user_id embedded in claims). Standard error envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "quantity must be positive", "field": "quantity" } }
```

---

### 1. `POST /api/v1/activities`
Add a user activity (food, transport, energy, etc.)

**Request**
```json
{
  "category": "food",
  "activity_type": "meal_logged",
  "subtype": "chicken_curry",
  "quantity": 0.35,
  "unit": "kg",
  "occurred_at": "2026-07-30T19:15:00+05:30",
  "source": "manual",
  "metadata": { "meal_slot": "dinner", "notes": "home-cooked" }
}
```

**Response `201`**
```json
{
  "id": "act_9f13a2",
  "status": "logged",
  "carbon_calculation": {
    "co2e_kg": 2.415,
    "emission_factor": { "id": "ef_chicken_v3", "source": "Poore_Nemecek_2021", "version": "v3" },
    "calculation_confidence": 0.82
  }
}
```

---

### 2. `GET /api/v1/recommendations/today`
Fetch today's ranked recommendation cards for the user.

**Response `200`**
```json
{
  "date": "2026-07-30",
  "recommendations": [
    {
      "id": "rec_8f2a11",
      "title": "Skip Chicken Today",
      "description": "Replace today's chicken meal with paneer.",
      "why": "You've eaten chicken on Thursday for 4 of the last 5 weeks.",
      "category": "food",
      "difficulty": "easy",
      "confidence": 0.78,
      "priority_rank": 1,
      "impact": {
        "saved_kg_co2e": 2.1,
        "percent_reduction": 87.0,
        "weekly_projected_kg": 1.95,
        "monthly_projected_kg": 8.48
      },
      "cta_label": "I'll do this",
      "tradeoff_note": "Similar protein content, lower iron — pair with greens if needed.",
      "expires_at": "2026-07-31T23:59:59+05:30"
    },
    {
      "id": "rec_8f2a12",
      "title": "Carpool to Work",
      "description": "Share today's commute instead of driving solo.",
      "why": "You've driven solo on 8 of the last 10 weekdays.",
      "category": "transport",
      "difficulty": "moderate",
      "confidence": 0.71,
      "priority_rank": 2,
      "impact": {
        "saved_kg_co2e": 1.4,
        "percent_reduction": 45.0,
        "weekly_projected_kg": 4.2,
        "monthly_projected_kg": 18.06
      },
      "cta_label": "Try this route",
      "tradeoff_note": "Requires coordinating with a colleague — slightly less flexible timing.",
      "expires_at": "2026-07-31T23:59:59+05:30"
    }
  ]
}
```

---

### 3. `GET /api/v1/recommendations/history?from=&to=&status=`
Fetch past recommendations with filters.

**Response `200`** (truncated)
```json
{
  "recommendations": [
    {
      "id": "rec_7a01c9",
      "title": "Switch Off Standby Devices",
      "status": "accepted",
      "shown_at": "2026-07-25T07:00:00+05:30",
      "responded_at": "2026-07-25T08:30:00+05:30",
      "saved_kg_co2e": 0.6
    }
  ],
  "pagination": { "next_cursor": "eyJpZCI6InJlY18..." }
}
```

---

### 4. `POST /api/v1/recommendations/{id}/feedback`
Submit user feedback on a recommendation.

**Request**
```json
{
  "event_type": "accepted",
  "reason_code": null,
  "metadata": { "responded_via": "push_notification" }
}
```

**Response `200`**
```json
{
  "recommendation_id": "rec_8f2a11",
  "status": "accepted",
  "acknowledged": true,
  "follow_up_scheduled": true
}
```

Valid `event_type` values: `accepted`, `dismissed`, `ignored`, `partially_completed`. (`behaviour_confirmed` / `behaviour_unchanged` are system-generated, not user-submitted.)

---

### 5. `PUT /api/v1/preferences`
Update user preferences.

**Request**
```json
{
  "primary_goal": "food_focus",
  "dietary_constraints": ["vegetarian"],
  "disabled_categories": ["shopping"],
  "max_recommendations_per_day": 2,
  "notification_channel": "push",
  "notification_time_pref": "07:30"
}
```

**Response `200`**
```json
{ "updated": true, "preferences": { "...": "echo of saved state" } }
```

---

### 6. `GET /api/v1/carbon/trends?period=weekly&range=8`
Fetch carbon trend data for charting.

**Response `200`**
```json
{
  "period": "weekly",
  "series": [
    { "week_start": "2026-06-08", "total_co2e_kg": 84.2, "by_category": { "food": 32.1, "transport": 40.5, "electricity": 11.6 } },
    { "week_start": "2026-06-15", "total_co2e_kg": 79.4, "by_category": { "food": 29.0, "transport": 39.0, "electricity": 11.4 } }
  ],
  "trend_direction": "decreasing",
  "percent_change_vs_previous": -5.7
}
```

---

### 7. `GET /api/v1/insights/behaviour`
Fetch detected behaviour patterns/insights for the user (powers "Habit Insights" UI section).

**Response `200`**
```json
{
  "patterns": [
    {
      "pattern_type": "meal_day_of_week",
      "summary": "You typically eat chicken on Thursdays",
      "confidence": 0.78,
      "occurrences": 4,
      "window_days": 56
    },
    {
      "pattern_type": "transport_weekday",
      "summary": "You drive solo to work on most weekdays",
      "confidence": 0.85,
      "occurrences": 8,
      "window_days": 14
    }
  ]
}
```

---

### 8. `GET /api/v1/analytics/recommendations?range=30d`
Fetch recommendation-performance analytics (for in-app "Impact" / "Progress" screens).

**Response `200`**
```json
{
  "range": "30d",
  "acceptance_rate": 0.41,
  "total_recommendations_shown": 62,
  "total_accepted": 25,
  "total_co2e_saved_kg": 38.7,
  "top_categories_by_savings": [
    { "category": "transport", "saved_kg": 21.4 },
    { "category": "food", "saved_kg": 12.9 }
  ],
  "most_effective_action_types": [
    { "action_type": "carpool_instead_of_solo_drive", "acceptance_rate": 0.62, "avg_saved_kg": 1.6 }
  ]
}
```

---

### 9. `POST /api/v1/recommendations/preview`
Generate an on-demand impact preview **before** committing to an action — e.g. user is comparing "what if I did X instead of Y" in-app, without it becoming a stored recommendation.

**Request**
```json
{
  "category": "food",
  "baseline_activity": "beef_burger_cooked",
  "baseline_quantity": 0.2,
  "unit": "kg",
  "candidate_alternatives": ["chicken_burger_cooked", "lentil_burger_cooked"]
}
```

**Response `200`**
```json
{
  "baseline_emissions_kg": 5.94,
  "alternatives": [
    { "activity": "chicken_burger_cooked", "emissions_kg": 1.38, "saved_kg": 4.56, "percent_reduction": 76.8 },
    { "activity": "lentil_burger_cooked", "emissions_kg": 0.18, "saved_kg": 5.76, "percent_reduction": 97.0 }
  ],
  "factor_source": "Poore_Nemecek_2021_v3"
}
```

This endpoint is what lets the frontend build an ad-hoc "what would it save if I swap X for Y" explorer, reusing the same Carbon Calculation Service used internally by recommendation generation — guaranteeing the numbers users self-explore always match the numbers the engine would generate.

---

### 10. `GET /api/v1/recommendations/{id}/explanation`
Fetch the full explanation detail (expandable "why am I seeing this?" view).

**Response `200`**
```json
{
  "recommendation_id": "rec_8f2a11",
  "why": "You've eaten chicken on Thursday for 4 of the last 5 weeks. Chicken has a higher carbon intensity than paneer, and today's swap is predicted to save 2.1 kg CO2e. This recommendation was ranked above other food suggestions because it has high expected impact and high acceptance probability.",
  "trigger_type": "pattern",
  "based_on": {
    "pattern_confidence": 0.78,
    "carbon_estimate_confidence": 0.82,
    "emission_factor_source": "Poore_Nemecek_2021",
    "emission_factor_version": "v3"
  },
  "why_this_over_alternatives": "Selected over 'chicken_to_lentils' due to slightly higher predicted acceptance based on your past feedback."
}
```
