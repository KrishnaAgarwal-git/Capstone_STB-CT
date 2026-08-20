# Personalised Carbon Recommendation Engine
## Part 5 — Frontend, UX & User Journeys

---

## 1. Dashboard Structure

```
┌─────────────────────────────────────────┐
│  Header: Today's Carbon Score  🔥 streak │
│  "12.4 kg CO2e today  ▼ 8% vs your avg"  │
├─────────────────────────────────────────┤
│  Weekly Trend (sparkline/line chart)      │
├─────────────────────────────────────────┤
│  TODAY'S RECOMMENDATIONS                  │
│  ┌───────────────┐ ┌───────────────┐     │
│  │ Recommendation │ │ Recommendation │     │
│  │ Card 1         │ │ Card 2         │     │
│  └───────────────┘ └───────────────┘     │
├─────────────────────────────────────────┤
│  Category Breakdown (donut/bar)           │
│  Food ▓▓▓▓▓░░  Transport ▓▓▓▓▓▓▓░         │
├─────────────────────────────────────────┤
│  Habit Insights                            │
│  "You usually drive on weekdays..."        │
├─────────────────────────────────────────┤
│  Achievements / Progress                   │
│  🏆 7-day streak   🌱 50kg saved this month│
├─────────────────────────────────────────┤
│  [History] [Settings] [Dark mode toggle]  │
└─────────────────────────────────────────┘
```

Design principles:
- **Recommendation cards are the hero content**, always above the fold, never buried under charts.
- **Numbers are never bare** — every kg CO₂e figure has a comparison anchor ("vs your average," "= X km not driven") so it's meaningful, not abstract.
- **Dark mode** as a first-class theme (not an afterthought) — carbon-conscious users skew toward valuing low-power-draw OLED-friendly dark UIs.
- **Responsive**: card grid collapses to single column <640px; charts resize via container queries, not fixed breakpoints.

---

## 2. Example Recommendation Cards (as rendered)

### Card — Mature personalisation, food
```
┌─────────────────────────────────────┐
│ 🍽  FOOD · Easy            ● 0.78    │
│                                       │
│ Skip Chicken Today                    │
│ Replace today's chicken meal with     │
│ paneer.                               │
│                                       │
│ 💡 You've eaten chicken on Thursday   │
│    for 4 of the last 5 weeks.         │
│                                       │
│ 🌍 Save 2.1 kg CO2e  (87% less)       │
│                                       │
│ ⚖️ Similar protein, less iron —       │
│    pair with greens if needed.        │
│                                       │
│  [ I'll do this ]      [ Not today ]  │
└─────────────────────────────────────┘
```

### Card — Early learning, transport
```
┌─────────────────────────────────────┐
│ 🚗 TRANSPORT · Moderate     ● 0.61   │
│                                       │
│ Try Carpooling Tomorrow               │
│ Share your commute instead of         │
│ driving solo.                         │
│                                       │
│ 💡 You've driven solo most weekdays   │
│    the past 2 weeks.                  │
│                                       │
│ 🌍 Save ~1.4 kg CO2e (est. 45% less)  │
│                                       │
│  [ Try this route ]    [ Not today ]  │
└─────────────────────────────────────┘
```

### Card — Cold start, generic
```
┌─────────────────────────────────────┐
│ ⚡ ENERGY · Easy             ● 0.55   │
│                                       │
│ Cut the Standby Drain                 │
│ Switch off devices instead of         │
│ leaving them on standby tonight.      │
│                                       │
│ 💡 A common early win — most homes    │
│    lose 5-10% of power to standby.    │
│                                       │
│ 🌍 Save ~0.3 kg CO2e today             │
│                                       │
│  [ Do this today ]     [ Not today ]  │
└─────────────────────────────────────┘
```

Note the **confidence dot + score visibly present but de-emphasised** (small, muted colour) — power users can learn what it means, but it never competes visually with the action itself.

---

## 3. Component Inventory

| Component | Purpose |
|---|---|
| `<CarbonScoreHeader>` | Today's total + trend arrow vs personal baseline |
| `<WeeklyTrendChart>` | Line chart, 8-week rolling |
| `<RecommendationCard>` | Core card, all fields from spec (title, desc, why, impact, difficulty, confidence, CTA, tradeoff) |
| `<CategoryBreakdown>` | Donut/bar showing emissions split |
| `<HabitInsightList>` | Plain-language pattern summaries from `/insights/behaviour` |
| `<ImpactPreviewModal>` | "What if I swap X for Y" explorer, backed by `/recommendations/preview` |
| `<AchievementBadge>` | Streaks, milestones (50kg saved, 30-day log streak) |
| `<HistoryTimeline>` | Past recommendations + outcome (accepted/dismissed/confirmed) |
| `<SettingsPreferencesPanel>` | Diet, mobility, disabled categories, notification prefs, consent toggles |

---

## 4. Notification Strategy

- **Default**: 1 push notification/day, sent at the user's preferred time (default 7am local), containing the single highest-priority card.
- **In-app feed** can show up to `max_recommendations_per_day` (default 3) — the push is a teaser, not the full list.
- **Timing intelligence**: transport recommendations fire ahead of typical commute time (learned from pattern), not at a fixed hour; food recommendations fire ahead of typical meal-logging time.
- **Fatigue auto-throttle**: if `fatigue_penalty` (Part 2 §4.4) crosses a threshold, push frequency auto-drops to every other day, with an in-app nudge: *"Want fewer notifications? You can adjust this in Settings."* — never silently reduces without disclosure.
- **Quiet hours** respected (no push 10pm–7am local by default).
- **Opt-out is one tap** from the notification itself (per spec's privacy requirements) — not buried in settings.

---

## 5. Sample User Journeys

### Day 1 — Cold Start
User signs up, logs first meal and one commute. No patterns exist yet.
- Dashboard shows today's calculated footprint from the 2 logged activities.
- Recommendation feed shows 2 generic, safe, high-likely-impact cards from the cold-start rule set: *"Try public transport for tomorrow's commute"* and *"Carry a reusable bottle"* — chosen because they're broadly applicable and don't require personal history to justify.
- Explanation copy is explicitly generic: *"A great starting habit for most people."*
- No push notification yet (avoid over-eager engagement on day 1); in-app feed only.

### Day 7 — End of Cold Start
Account has 6 days of logs (varying completeness). `BPD` has enough data to store its first low-confidence patterns (confidence ~0.35–0.5).
- Dashboard introduces the **Habit Insights** section for the first time: *"We're starting to notice a few patterns — check back in a couple weeks for more personalised tips."*
- Recommendations remain mostly generic but start hedging toward observed signals: *"You've logged a few solo car trips this week — try public transport for one of them."* (early-pattern rule tier, Part 1 §1.2, confidence in the 0.35–0.65 band)
- First push notification sent, timed at the user's declared wake-up preference.

### Day 30 — Mature Personalisation
Patterns have crossed the 0.65+ confidence threshold for at least 2-3 categories (e.g. Thursday chicken, weekday solo driving).
- Dashboard shows a full weekly trend chart with a visible downward slope if the user has been acting on recommendations.
- Recommendation feed shows the **specific, high-confidence** cards from the spec ("Skip Chicken Today... 2.1 kg CO2e... 87% less").
- Achievements unlock: *"🌱 You've saved 8.4 kg CO2e this month"*, *"🔥 12-day logging streak."*
- Analytics quietly begin surfacing in the Feedback loop: if the user dismissed 3 transport recommendations, that category soft-suppresses per Part 2 §6.3, and the feed shifts weight toward food/energy where acceptance has been higher.

### Day 90 — Long-Term Engagement
Full behavioural history, feedback history, and multiple confirmed behaviour changes.
- Dashboard's headline metric shifts emphasis from daily score to **trend**: *"Your footprint is 22% lower than your first month."*
- Recommendations become increasingly about **variety and maintenance** rather than novel discovery — e.g. rotating between chicken→paneer and chicken→lentils to avoid repetition fatigue (Part 2 §4.5), and occasionally surfacing a "streak protection" nudge: *"You've skipped meat on Thursdays for 6 weeks straight — keep it going?"*
- If engagement has dropped (fewer logs, more ignores), the system may proactively surface a lighter-touch, easy-win recommendation to re-engage rather than a demanding one, using the fatigue/re-engagement logic.
- History view becomes rich enough to support a "Year in Review"-style retrospective (natural extension, not in V1 scope but architecturally trivial given the stored data).

---

*Continued in Part 6: Testing Strategy, Analytics Strategy, ML Roadmap, Production Considerations.*
