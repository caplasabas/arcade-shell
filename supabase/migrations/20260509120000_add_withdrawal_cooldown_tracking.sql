alter table public.devices
  add column if not exists last_withdrawal_at timestamptz,
  add column if not exists withdraw_cooldown_until timestamptz;

comment on column public.devices.last_withdrawal_at is
  'Most recent withdrawal start recorded by the cabinet service.';

comment on column public.devices.withdraw_cooldown_until is
  'Withdrawal requests are rejected by the cabinet service until this timestamp.';
