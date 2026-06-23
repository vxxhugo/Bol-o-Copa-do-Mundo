with target as (
  select
    state.id,
    array_agg(user_item.value ->> 'id') as user_ids
  from public.bolao_state as state
  cross join lateral jsonb_array_elements(coalesce(state.data -> 'users', '[]'::jsonb)) as user_item(value)
  where state.id = 'main'
    and lower(user_item.value ->> 'email') = 'emaildojotinha0@gmail.com'
  group by state.id
)
update public.bolao_state as state
set
  data = jsonb_set(
    jsonb_set(
      jsonb_set(
        state.data,
        '{users}',
        coalesce(
          (
            select jsonb_agg(user_item.value)
            from jsonb_array_elements(coalesce(state.data -> 'users', '[]'::jsonb)) as user_item(value)
            where lower(user_item.value ->> 'email') <> 'emaildojotinha0@gmail.com'
          ),
          '[]'::jsonb
        )
      ),
      '{predictions}',
      coalesce(
        (
          select jsonb_object_agg(prediction.key, prediction.value)
          from jsonb_each(coalesce(state.data -> 'predictions', '{}'::jsonb)) as prediction(key, value)
          where not (prediction.key = any(target.user_ids))
        ),
        '{}'::jsonb
      )
    ),
    '{sessions}',
    coalesce(
      (
        select jsonb_object_agg(session_item.key, session_item.value)
        from jsonb_each(coalesce(state.data -> 'sessions', '{}'::jsonb)) as session_item(key, value)
        where not (session_item.value #>> '{}' = any(target.user_ids))
      ),
      '{}'::jsonb
    )
  ),
  updated_at = now()
from target
where state.id = target.id;
