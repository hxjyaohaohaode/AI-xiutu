export const schemaV22Sql = String.raw`
ALTER TABLE asset_derivations DROP CONSTRAINT asset_derivations_algorithm_check;
ALTER TABLE asset_derivations ADD CONSTRAINT asset_derivations_algorithm_check
  CHECK (algorithm IN ('linear-trimap-v1','rgb-guided-trimap-v2','rgb-guided-trimap-v3',
    'rgb-guided-trimap-v4','rgb-guided-trimap-v5','continuous-alpha-v1','collage-v1',
    'gif-v1','photo-restore-v1'));
`;
