-- Backfill gross_contribution and fees_contribution for ShipmentEvents
-- from raw_json. All events were stored with 0.00 for these columns.
-- After this migration the April revenue breakdown (gross → fees → net) is live.

-- ShipmentEvents: Principal charges = gross sales, ItemFeeList = Amazon fees (negative)
UPDATE amazon_financial_events afe
SET
  gross_contribution = (
    SELECT COALESCE(
      SUM((charge -> 'ChargeAmount' ->> 'CurrencyAmount')::numeric), 0
    )
    FROM jsonb_array_elements(afe.raw_json -> 'ShipmentItemList') AS item,
         jsonb_array_elements(item -> 'ItemChargeList') AS charge
    WHERE charge ->> 'ChargeType' = 'Principal'
  ),
  fees_contribution = (
    SELECT COALESCE(
      SUM((fee -> 'FeeAmount' ->> 'CurrencyAmount')::numeric), 0
    )
    FROM jsonb_array_elements(afe.raw_json -> 'ShipmentItemList') AS item,
         jsonb_array_elements(item -> 'ItemFeeList') AS fee
  )
WHERE event_type = 'ShipmentEvent';

-- RefundEvents: Principal in ItemChargeAdjustmentList = refund amount (negative)
-- Fee adjustments in ItemFeeAdjustmentList (positive = fees returned to seller)
UPDATE amazon_financial_events afe
SET
  refunds_contribution = (
    SELECT COALESCE(
      SUM((charge -> 'ChargeAmount' ->> 'CurrencyAmount')::numeric), 0
    )
    FROM jsonb_array_elements(afe.raw_json -> 'ShipmentItemAdjustmentList') AS item,
         jsonb_array_elements(item -> 'ItemChargeAdjustmentList') AS charge
    WHERE charge ->> 'ChargeType' = 'Principal'
  ),
  fees_contribution = (
    SELECT COALESCE(
      SUM((fee -> 'FeeAmount' ->> 'CurrencyAmount')::numeric), 0
    )
    FROM jsonb_array_elements(afe.raw_json -> 'ShipmentItemAdjustmentList') AS item,
         jsonb_array_elements(item -> 'ItemFeeAdjustmentList') AS fee
  )
WHERE event_type = 'RefundEvent';

-- AD7-exempt: UPDATE only, no CREATE TABLE
