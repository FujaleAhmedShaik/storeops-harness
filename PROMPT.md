Add shift handover bulk update. PATCH /api/activities/bulk-status lets outgoing shift staff mark many operational
activities DONE or BLOCKED in one request. Handle partial failure: valid items are updated, invalid ones are reported per item
with a reason code, and one bad item never aborts the others. Only an activity's creator, assignee or a supervisor may update
an item, activities of other stores are rejected, and the existing status transition rules still apply. Write an audit entry per
updated activity by emitting an event that the alerts module records. Limit a request to 50 items.
