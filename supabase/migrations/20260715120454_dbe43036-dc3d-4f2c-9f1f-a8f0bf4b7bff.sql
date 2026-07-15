-- Stage 6 Consolidated Cleanup Patch
-- Guarded soft-archive for legacy payments_v2 rows.
-- No physical DELETE. All changes wrapped in a single transaction with
-- fail-closed drift checks. Manifest is embedded inline (frozen at PREVIEW time).

DO $stage6$
DECLARE
  v_a_pay_expected int := 8;
  v_a_ord_expected int := 7;
  v_a_sub_expected int := 4;
  v_a_doc_expected int := 7;
  v_c_pay_expected int := 113;
  v_e_pay_expected int := 201;

  v_actual int;
  v_queue_checksum_before text;
  v_queue_checksum_after  text;
  v_bepaid_checksum_before text;
  v_bepaid_checksum_after  text;
BEGIN
  ------------------------------------------------------------------
  -- 0. Materialise manifests into temp tables
  ------------------------------------------------------------------
  CREATE TEMP TABLE m_a_payments (id uuid PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO m_a_payments VALUES
    ('38b920da-12d9-40ad-bc8c-c113b0cfdbed'::uuid),
    ('7cf98263-0495-4c5b-a6a8-77304c548b41'::uuid),
    ('87aa9795-39f9-4a9f-83f1-9ccfb860e0f7'::uuid),
    ('8fee626c-b3a8-48ca-b3df-7cc8de857a91'::uuid),
    ('90fe6cd0-379f-40d4-b043-b5cc28737fda'::uuid),
    ('b211c2b8-9952-438e-a4ae-0dacc2061a62'::uuid),
    ('c1640bba-4bb2-409d-adf3-0f9276756a19'::uuid),
    ('e4a38b1c-f1cf-483d-afdf-a30320ad9602'::uuid);

  CREATE TEMP TABLE m_a_orders (id uuid PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO m_a_orders VALUES
    ('1e3c6a55-a540-48f5-8d58-53a746dbabc6'::uuid),
    ('42e9adc1-dcd9-48ec-9a15-538cebb87039'::uuid),
    ('4e1df0cc-ae9a-4436-b144-6dfb84b369ff'::uuid),
    ('7676f283-d271-4a73-8f1d-df267d76c862'::uuid),
    ('779b4105-a446-4ff0-9034-b7d138b64b77'::uuid),
    ('99f7071c-bfd6-46f2-8d5c-38fa61a7f867'::uuid),
    ('bd936b5e-3b39-4b5a-ae8d-eb80fd8e213e'::uuid);

  CREATE TEMP TABLE m_a_subs (id uuid PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO m_a_subs VALUES
    ('1a9b846d-503e-43e3-af52-33962b742f3e'::uuid),
    ('28fe373e-31df-4573-8409-5dfdc28582df'::uuid),
    ('54cb447b-4137-46c8-84b9-7eb8a2a541af'::uuid),
    ('ffcaddf7-5f65-4fcb-819b-f9a55f7e8cb0'::uuid);

  CREATE TEMP TABLE m_a_docs (id uuid PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO m_a_docs VALUES
    ('12b34412-590a-4abf-b101-6a3a533ecf43'::uuid),
    ('6318d1b8-2593-42c4-b763-dd6949d934d3'::uuid),
    ('94e1b4e5-8c2e-4271-8d16-6b354a9bc907'::uuid),
    ('ae386487-4253-49cc-b333-051e6e6ad91a'::uuid),
    ('d0a9fced-ea1c-4849-9087-6c50ac978298'::uuid),
    ('dc4f01eb-dc95-43e7-bb5f-bf83e715ead5'::uuid),
    ('f07cc0de-958a-4259-a2d7-45f15bed2b25'::uuid);

  CREATE TEMP TABLE m_c_payments (
    legacy_id uuid PRIMARY KEY,
    canonical_id uuid NOT NULL,
    queue_id uuid NOT NULL,
    expected_amount numeric NOT NULL,
    expected_currency text NOT NULL
  ) ON COMMIT DROP;
  INSERT INTO m_c_payments VALUES
    ('00956264-cafc-4522-a7a8-2f9feb551aae'::uuid,'af5b72c6-247d-4589-b4f0-cecf4eb8caa3'::uuid,'6bb61864-229d-4f20-9f89-ee8a12a13ee5'::uuid,900.00::numeric,'BYN'),
    ('023c6051-eb1e-4b5a-a55d-1ef519ca7a1c'::uuid,'f89bbd1b-be68-453d-81f5-8b9d45149149'::uuid,'6711f0cb-90b2-4d70-be93-c169de649ab7'::uuid,250.00::numeric,'BYN'),
    ('06d7e36a-58fa-4a0c-820a-5041f9e42d7c'::uuid,'7e39bf5e-ac87-47ce-a901-5c23b157f4aa'::uuid,'40db788f-7e3a-408d-b371-637589e98d17'::uuid,250.00::numeric,'BYN'),
    ('07f997a5-0b82-4f56-a0b7-b7c8796ee51b'::uuid,'df6aa6cd-8b8d-46f8-9ced-d36b90bae5a8'::uuid,'1a3d30b4-1e6b-442a-9bd5-af9f1b2eda42'::uuid,1.00::numeric,'BYN'),
    ('08acc0cb-c1f5-4b0c-838b-76d0125546e7'::uuid,'a7ff34a6-1f7f-48e6-9027-7c4ad7b8bfb0'::uuid,'8aaca492-3ace-4ed9-ab2e-25392ec4c681'::uuid,250.00::numeric,'BYN'),
    ('0bde9709-9a89-4629-b364-a3b8758fcd18'::uuid,'313e117d-e74f-45d6-a892-81b178d5cb91'::uuid,'6e98137c-3e0e-4d73-a640-6408c5faf14a'::uuid,55.00::numeric,'BYN'),
    ('114e9b93-bb19-4a3e-984e-02f5ea37c3e7'::uuid,'c1e38e9d-55ad-4017-9aa4-deb8a236b8fd'::uuid,'f502acce-9969-463e-8958-a7520aa73e0e'::uuid,330.00::numeric,'BYN'),
    ('123b56e9-2544-4d5f-ab1b-c26886dbda11'::uuid,'39e8dd77-0b51-4e3c-8c30-7e247dccac18'::uuid,'009bc516-9911-4390-86a3-c7885887c576'::uuid,150.00::numeric,'BYN'),
    ('12ff2996-8496-473e-8fe6-d6ccfb2a0efb'::uuid,'c36421d3-2110-4cac-858c-b3efb80f98b8'::uuid,'1279de1f-f55d-4162-a9c9-d80f727cba9b'::uuid,250.00::numeric,'BYN'),
    ('1435dd26-0df4-4145-bf4a-f01fb2f44f80'::uuid,'6e812ae6-263d-4a31-aca3-c8cee2d78fb1'::uuid,'48284fd5-224e-4e96-9839-6cf4107f193c'::uuid,250.00::numeric,'BYN'),
    ('144441b1-107d-4013-b077-88a1661905bb'::uuid,'1b7b41d6-faf5-4ecf-8962-b3518dd019ad'::uuid,'65813fe8-0c70-47f4-ba32-be7588f4065a'::uuid,250.00::numeric,'BYN'),
    ('1711a2dd-bd50-4889-baf4-5b4a13c1bb97'::uuid,'9af13cc1-833a-48ef-90fa-4933df9d62a6'::uuid,'08734979-453a-4374-9989-6ffed8d01643'::uuid,100.00::numeric,'BYN'),
    ('18e93d7a-3d3f-4e73-a34d-8f3c627d1716'::uuid,'9b6e5443-4f01-4d6f-8f1b-b578117dbafe'::uuid,'a79af079-950f-4156-9632-1462ec08142b'::uuid,250.00::numeric,'BYN'),
    ('1922bc40-5b86-4dbd-a0aa-a660d67889b8'::uuid,'a6e66b83-b823-440e-a938-dd06958d0f22'::uuid,'273e753c-0d91-4c34-ac48-f948654971af'::uuid,250.00::numeric,'BYN'),
    ('1cc9c88c-70e9-4481-9cb3-ee3de1b24b5c'::uuid,'ea9ceae4-95cd-4131-bf25-2057c76d8eca'::uuid,'1a5d0c82-8c0f-4a2b-9537-d3caa3e71e88'::uuid,250.00::numeric,'BYN'),
    ('1e2abdb7-50b3-4b80-8b00-1a7a32a7dc85'::uuid,'bafa1bec-d152-4613-8243-31bdf4784773'::uuid,'9aeba071-59a2-4193-b044-1341e265c399'::uuid,250.00::numeric,'BYN'),
    ('20c22102-23e8-4ac5-8c7e-37ef57ed2102'::uuid,'9f4bd46c-39ec-45f9-82c3-b4cffc8bf9a1'::uuid,'b25ef91e-149d-46d6-86e2-8ccab01a1988'::uuid,100.00::numeric,'BYN'),
    ('24791a62-b57f-4222-a498-d2321017e139'::uuid,'a45efff6-2741-4ce4-9af5-998497fc9805'::uuid,'9c5e84e6-ffb1-4471-923e-54d5f4a77199'::uuid,250.00::numeric,'BYN'),
    ('25c216dd-53ae-4ada-9466-1910d3e06999'::uuid,'59299d10-542a-486b-b1db-eb3866b530bc'::uuid,'32684935-e71e-4079-b9ab-850d2eecfca7'::uuid,250.00::numeric,'BYN'),
    ('2cfe171a-ccf5-46e5-82a8-c6f4180efab2'::uuid,'25dcb765-ac4a-4c13-8e24-81aaf6777f05'::uuid,'73cb93ed-4a4c-4b3d-9b56-e2fdfd44418a'::uuid,250.00::numeric,'BYN'),
    ('2e4e465b-deba-4744-8426-7fa7a0ab642e'::uuid,'0aee1c2e-3965-4cd7-b29f-a2384778d501'::uuid,'88a131e4-5858-4033-88c0-1ac98281cc21'::uuid,250.00::numeric,'BYN'),
    ('2e8ee000-ed66-4be4-9ae2-60364976be88'::uuid,'5f112f0d-62bb-42e5-9e3d-875cae8f4bdc'::uuid,'824020ac-e519-4592-9792-684cf567c938'::uuid,100.00::numeric,'BYN'),
    ('2ea9172f-d88a-4150-a2ea-8d119818f8e3'::uuid,'49ca2ad7-ea80-4b8f-9cd0-1df4d1b0fbb1'::uuid,'8d91ce0a-e63f-457e-ace6-44384f503ba0'::uuid,55.00::numeric,'BYN'),
    ('2eca335a-7bf9-4359-9854-7cb6561ea47c'::uuid,'147294e6-0c36-40c3-b68c-d3431c97133f'::uuid,'e105efa5-2f63-4a22-b274-b41dc2284ec9'::uuid,250.00::numeric,'BYN'),
    ('33bdeca9-4e3e-4840-b27e-e69746c25916'::uuid,'a24c8508-a6f4-462a-bc99-6bf6c4d3f245'::uuid,'19a66ef3-6cd4-4f08-b104-221b00e1543c'::uuid,250.00::numeric,'BYN'),
    ('3ab53ea9-dc11-4658-a356-a3673ad1df3c'::uuid,'69c250f6-2312-43f0-8ef1-16ce70b20a3e'::uuid,'eac01492-aaeb-40de-99ba-4d3baa85d4d2'::uuid,150.00::numeric,'BYN'),
    ('3d8aecbd-4491-41ab-8116-7020e099b60e'::uuid,'9ad21565-1709-4908-bc2d-9fe1b6e548e9'::uuid,'32e421d6-53cd-493a-b365-13c2320bf2ce'::uuid,75.00::numeric,'BYN'),
    ('3ddbc394-f69e-447e-b084-89991852a7a0'::uuid,'edb910ca-44b5-4f36-8ad4-3900eacdbc2c'::uuid,'b5a9ea08-163e-43a8-9988-364cd97a6e4a'::uuid,150.00::numeric,'BYN'),
    ('3e656276-541f-461f-ae55-e818cbdabee9'::uuid,'7fb7e489-6d89-4609-baad-e005bb5f18a7'::uuid,'c4e84d21-e7b3-409a-acc6-f74b2a6cae8c'::uuid,250.00::numeric,'BYN'),
    ('3fd5c095-9a44-4dda-9880-1358c53be7e6'::uuid,'0d7a78c1-b614-4530-b57f-69d389078c6f'::uuid,'d7c7f53f-6be2-4468-939c-addcb5601772'::uuid,250.00::numeric,'BYN'),
    ('412fd764-e227-4410-b218-70c630b82b78'::uuid,'b350bb52-df46-4afa-b698-faa1af554e29'::uuid,'8a20667e-ff5b-4579-b87d-90b1b481a07f'::uuid,250.00::numeric,'BYN'),
    ('43282ffb-4e48-4621-9dc4-9ef27589cca6'::uuid,'a76e0bdf-8885-4a32-8113-7cea59f68c25'::uuid,'373a15d1-506c-4d30-8d06-ff3755f1aa32'::uuid,300.00::numeric,'BYN'),
    ('461bbd97-fc56-4aba-be40-f4838c3d6e13'::uuid,'77dad4a3-fa05-49fd-b027-fe45228a695c'::uuid,'9f3c3d9d-5a36-4b4e-8e36-77c0a1663dd3'::uuid,250.00::numeric,'BYN'),
    ('4a073c49-8412-41a7-9ed1-1453a62d9fca'::uuid,'11bbfc1e-99e9-44c5-9e47-d6ea3dc49e17'::uuid,'516fafb6-539e-4df5-a9b5-9c4fa5702171'::uuid,150.00::numeric,'BYN'),
    ('4afe1a0c-7fd6-4643-9152-d1d6d60258c7'::uuid,'fd7e2f45-9c6b-4002-92a6-a8b196deeca6'::uuid,'64463b66-e56f-49a7-9b7f-1ed831cc69f4'::uuid,150.00::numeric,'BYN'),
    ('4e349305-b73d-4b92-a3ed-9628e34e8420'::uuid,'afbeec4c-af69-4ca1-9cb3-d7ca3b4b36fa'::uuid,'15d8dfb7-c6f7-4d79-b683-954c11f2be03'::uuid,1.00::numeric,'BYN'),
    ('4f2cb48f-7f3f-455e-b2c1-7f7d5d47e356'::uuid,'454be107-29a6-499f-9953-d5e93cc1b02c'::uuid,'0afb4824-3d45-4c4d-b6df-7f580ca8edcd'::uuid,250.00::numeric,'BYN'),
    ('5444b49f-11e5-4a2c-a09d-ef373a1661e8'::uuid,'b0df186a-b0df-479f-885e-73a85dfa679d'::uuid,'1dc847bb-10a6-4c43-b962-0fa7908c91c3'::uuid,600.00::numeric,'BYN'),
    ('564b7392-0a64-4fa9-8b34-42bfd8aa7eb7'::uuid,'67ab5f15-9800-47b6-a045-d0511d280f28'::uuid,'8f30521f-76d4-4030-a354-e58ae8e0208c'::uuid,250.00::numeric,'BYN'),
    ('578f7efa-3fed-4540-895c-c70086262efc'::uuid,'38e26ec6-c8f5-45ae-bd80-99ca22983f3c'::uuid,'ccf63c98-a0ab-4043-9fc9-8a1d57131056'::uuid,150.00::numeric,'BYN'),
    ('58305ecb-3180-4e90-af73-85164e98b74b'::uuid,'7aa17a7b-ae23-433e-b383-c8f2a808fb7f'::uuid,'fdc2b5f0-2ff0-4172-a454-a68da99cb136'::uuid,230.00::numeric,'BYN'),
    ('5cf9e21c-86f5-4d96-ae6b-4b9154e2eb90'::uuid,'023e4487-6110-453d-ae7c-4c056f480f05'::uuid,'4547618a-4e9c-4820-8697-bbadc8f0048a'::uuid,150.00::numeric,'BYN'),
    ('5ded2798-9b61-4aa9-bd5a-592ed2c1438e'::uuid,'e680ddac-79b4-44f3-a8e9-c5cad8cd18f8'::uuid,'81e13051-16dc-45a4-9ca3-70b48371a887'::uuid,250.00::numeric,'BYN'),
    ('6005ece7-badf-44be-bea0-a08594d69e16'::uuid,'2f094a11-afa8-4e2e-a595-23914f96f733'::uuid,'fa8fbdce-f1b5-4af8-b81c-862e7c226cd8'::uuid,250.00::numeric,'BYN'),
    ('644f27e5-fcfb-4ef7-b8b5-687b6b9f6156'::uuid,'e0a2d996-9053-4584-801d-2b7e2bfc4b8d'::uuid,'4242bfbe-1294-4d1c-9832-1b3a214d400c'::uuid,150.00::numeric,'BYN'),
    ('6491944f-bd9e-4764-9709-a54df2ad6ad9'::uuid,'cc9ff9ce-9fb3-45ae-bf97-30cc180364ae'::uuid,'533abec4-10c7-49f4-bbae-d9424f2fe9ff'::uuid,150.00::numeric,'BYN'),
    ('66657c81-aefb-4c13-b856-efff8c17fc30'::uuid,'bfd9eb8a-73de-44e0-a6f9-9b530b6c7412'::uuid,'c1f23f61-1df9-4da4-9a85-366d401cd163'::uuid,1.00::numeric,'BYN'),
    ('676a15fb-baf8-4b49-bf14-3155b5894671'::uuid,'5d49594c-a5a4-41dd-8f0a-c090a73e8bdf'::uuid,'d16761ed-fb6e-4281-8da6-ce9f22069ffe'::uuid,250.00::numeric,'BYN'),
    ('6bd8c9bc-d219-47db-b982-0d07c75d8ee7'::uuid,'aba61497-dff2-4aea-a576-634ad7cbef2c'::uuid,'07f4f8f4-21ae-4e82-b842-f1419a27c696'::uuid,250.00::numeric,'BYN'),
    ('6d6a1568-30e8-4aad-8513-e263af3216b8'::uuid,'8fcc3bd2-b4d8-4fa1-86c9-2188279f220e'::uuid,'10fe06f5-6a33-42cd-99e5-d4b96849a35e'::uuid,250.00::numeric,'BYN'),
    ('71361253-c457-46b5-be95-e9d66a8494a0'::uuid,'31ad95bd-31f9-4361-bff2-a5c5cdb22db2'::uuid,'21ec48dc-2aec-4cde-bfa8-88c55c55025a'::uuid,250.00::numeric,'BYN'),
    ('72b673a9-df4c-4de1-8044-a012e75e5f10'::uuid,'a7be96e7-5a48-431b-85b1-9ecf97597cae'::uuid,'9b2235c7-4110-4101-a5f3-88871f79d563'::uuid,250.00::numeric,'BYN'),
    ('73b8f176-015c-45e3-aba0-b62354b3fa19'::uuid,'1cf5dc10-c0b2-4bc1-87a3-480706d86a85'::uuid,'f4fb5922-1ad5-48de-950c-9403ae7cc495'::uuid,250.00::numeric,'BYN'),
    ('740bcafa-104d-47cf-9bd9-06e419087f05'::uuid,'a76bacd1-0d54-41cb-88e2-caabb86a5fc5'::uuid,'ecae4fb2-3865-4472-b4a5-7b7319663f1f'::uuid,150.00::numeric,'BYN'),
    ('748686b3-48b8-44e6-b1ca-e721c7797a34'::uuid,'459f09fb-83dd-4e94-9dff-8f87b12ebf7f'::uuid,'6342b870-3307-4637-9f26-cd3eee2781a4'::uuid,250.00::numeric,'BYN'),
    ('76f05a4f-eedc-4d61-bfe7-3e035d2b5ce1'::uuid,'875f214b-fb44-425b-911a-1d91dd5ac31e'::uuid,'9bce94d5-29d1-498b-b8f3-d7a2910e13dd'::uuid,250.00::numeric,'BYN'),
    ('7aadddc4-b2af-477a-ba2b-5b6fccb7e98b'::uuid,'e0a2d996-9053-4584-801d-2b7e2bfc4b8d'::uuid,'4242bfbe-1294-4d1c-9832-1b3a214d400c'::uuid,150.00::numeric,'BYN'),
    ('7e953bc7-f619-420c-91b5-9908a8b7578f'::uuid,'98f093d9-1b88-4ea6-bb19-272a7568cb96'::uuid,'fed2ce18-0d40-449c-9156-0f29827175ba'::uuid,150.00::numeric,'BYN'),
    ('7fd564d1-a1d8-4658-a025-b5318e6354f8'::uuid,'ee8b8ea4-7942-4f3a-a2a2-7e67a4371aeb'::uuid,'48959abd-cf69-4947-82fa-eac41bdf9ed1'::uuid,250.00::numeric,'BYN'),
    ('80cfe2bf-9b61-46f1-903f-1874b1903f41'::uuid,'9d950ea4-927f-4222-9ecc-bcb0ebe61c73'::uuid,'216ba84c-baf6-45b1-8bd5-90a4deae97ea'::uuid,250.00::numeric,'BYN'),
    ('86546dfe-b036-40de-a97b-c4a21a7dfabc'::uuid,'8db22641-e337-4fed-9fa0-11662e57fb8d'::uuid,'f2388feb-412d-436d-a077-875b9b6a8e13'::uuid,250.00::numeric,'BYN'),
    ('897ea700-44ff-4f93-bd7d-2d20ec8d6ae5'::uuid,'9b6e5443-4f01-4d6f-8f1b-b578117dbafe'::uuid,'a79af079-950f-4156-9632-1462ec08142b'::uuid,250.00::numeric,'BYN'),
    ('8bf8cb4b-71bf-4bfb-bb0e-bc94c9daff49'::uuid,'33b7cbba-70c5-4dc6-ae32-70596e185b05'::uuid,'abb165c6-2758-4686-ba66-c7b5766bb87c'::uuid,250.00::numeric,'BYN'),
    ('8cbc5122-fd6a-44d7-9cde-d1cad95c8c75'::uuid,'41bfbc0a-77ba-4a27-8643-40e0585361a2'::uuid,'d6901bec-dff4-4eaa-9516-5964636c65fe'::uuid,150.00::numeric,'BYN'),
    ('9318eb82-efea-4ba1-a979-5fe8b7e3ba59'::uuid,'cc8e6320-cb53-4ae8-8318-9e49d1b5ba05'::uuid,'b80c7418-626c-41ac-a9f8-d7ff7c8eb189'::uuid,250.00::numeric,'BYN'),
    ('941c52bc-9fee-4171-96a7-6cc6d59a75df'::uuid,'55b9e1df-23b0-4c42-81cb-84b0da60cd14'::uuid,'ebbaf450-f60a-4c56-9ee9-e6f8a8eef5ab'::uuid,150.00::numeric,'BYN'),
    ('948f33b1-a6ef-4d08-8c92-fd685f876794'::uuid,'fbf786b3-a435-4837-bbb1-83ec269f9b99'::uuid,'443650d1-06bf-44be-8871-c996d1015376'::uuid,250.00::numeric,'BYN'),
    ('94fda5b8-1a65-4fd5-a3fe-ff2413054aa7'::uuid,'9644eb3b-08fa-4668-b323-848b2c31a738'::uuid,'eeb86130-e37e-472e-a353-411d67f5be2c'::uuid,55.00::numeric,'BYN'),
    ('953cedd1-4132-4cda-8b97-644dac628268'::uuid,'85b7bfa0-1502-47b6-86d0-f911ffbe35dc'::uuid,'4a605698-8711-4c55-a8ae-76e0cef50823'::uuid,250.00::numeric,'BYN'),
    ('95c7ca95-42ec-4d5e-8569-f177728276a4'::uuid,'f61fa469-8120-4ec4-bf0e-b66f75f8f6e2'::uuid,'dc5327e6-99f2-416f-bb5c-5d1c88bf3eff'::uuid,250.00::numeric,'BYN'),
    ('9692a501-78b8-42fa-93d9-d508361fb3d3'::uuid,'6c4b8e95-a622-4aaf-84d8-db97476a89fd'::uuid,'3b8d6014-75e5-4ea7-80df-9ad39cf4bb38'::uuid,55.00::numeric,'BYN'),
    ('9862aae2-dd85-4e2a-8ecb-d9ff8e192f44'::uuid,'9fefd5e4-053b-4563-8db8-9503e16ccf72'::uuid,'3acc35a0-46cb-41b3-ab8e-9f662a80274d'::uuid,100.00::numeric,'BYN'),
    ('9909e5cb-b1aa-4c6d-9bb1-08a8b220bf7f'::uuid,'655e80a2-346f-4934-b5df-2729eb5cc7dd'::uuid,'f21d9259-0ef3-49b3-a0e2-7f69dac9ad8b'::uuid,250.00::numeric,'BYN'),
    ('9d262108-73b0-4a3c-b7ec-5693b0e412b5'::uuid,'831113fb-77e7-4f63-bd0a-b0229e1db681'::uuid,'d70e7c99-a0d3-4828-98e2-82da6a062a13'::uuid,100.00::numeric,'BYN'),
    ('9f32cba5-9769-4719-96a8-d9cb608e3096'::uuid,'d1973c99-4e2f-4ca5-a2f4-33b33e5fece0'::uuid,'3fdd273d-026d-47d7-9ebf-97faa6423b87'::uuid,55.00::numeric,'BYN'),
    ('a127ace1-3c97-474b-beea-f93dc654eec6'::uuid,'56617c92-7d78-4e29-bb59-c4b8c46378fd'::uuid,'a45ec0f1-80a5-4462-9156-acddc38813c0'::uuid,250.00::numeric,'BYN'),
    ('a386f607-4da8-4df4-94af-a2c095150b20'::uuid,'6a709311-ef93-4195-ab1e-5ff33b6a42ee'::uuid,'26c7a3b0-3950-4f06-a4e5-41e3aa275238'::uuid,250.00::numeric,'BYN'),
    ('ad0cf694-b3fc-4ef7-97e5-9604235dfa4d'::uuid,'3d4cc272-27ea-4473-a058-000b723e92ca'::uuid,'57f36aa2-7183-4d20-9929-7e82c36c00d4'::uuid,150.00::numeric,'BYN'),
    ('ae5ac541-1d39-4302-9844-522e92b64748'::uuid,'eac17f04-134f-46c9-b909-c58cf316d5a8'::uuid,'a6016072-a7d7-4752-b376-e964aa7aff30'::uuid,250.00::numeric,'BYN'),
    ('ae7767ce-fd18-4219-bbf3-2e64e0fc9b38'::uuid,'67ad3cd7-25af-410c-aa24-a6f659229263'::uuid,'4e23829f-dad2-4fbb-81fe-b514a6dbd127'::uuid,230.00::numeric,'BYN'),
    ('af065c3e-18a8-4152-a91f-7af3290c13f1'::uuid,'0ddffa5f-3acd-4721-aa35-c734fa3378a1'::uuid,'87ca3bc5-5158-4b74-a681-efc8cc1122cf'::uuid,70.00::numeric,'BYN'),
    ('b074afef-2649-48ce-9c3d-f028932c3f8c'::uuid,'3091b206-2d62-4eef-a386-bb1c4b125b97'::uuid,'ef2e4c1a-5860-4184-af3f-4e7a48ec3321'::uuid,150.00::numeric,'BYN'),
    ('b0b8758a-d1b6-412f-b823-45de1b3bb83c'::uuid,'ac90c0f3-15f7-41b9-a626-8c4ede8591ce'::uuid,'24f81ecb-2d51-43b6-898c-2b68502dfe2d'::uuid,250.00::numeric,'BYN'),
    ('b5c3cb43-1d57-4594-b378-65f9536a3090'::uuid,'c19d161c-9952-4b02-9a1b-625498aea086'::uuid,'5fb566ee-47e0-439c-a8ec-fd810ae3079c'::uuid,250.00::numeric,'BYN'),
    ('b5e9f845-c71e-404e-81a1-4dbd294e1106'::uuid,'dea16da3-3ca1-4a04-a5db-5d0c39458b45'::uuid,'61f91068-b545-4190-a158-0ca22624f5de'::uuid,150.00::numeric,'BYN'),
    ('b921d5e0-f527-43f2-af7b-71796a239455'::uuid,'7f456ba8-8f28-49a7-9c44-9d7b973b7c94'::uuid,'a83300ff-be9f-492f-b1fc-8a8b7462639e'::uuid,150.00::numeric,'BYN'),
    ('bc2c6bb3-26e4-4058-b44d-138bcd5c420f'::uuid,'93c53e9d-020d-4548-a090-cf40ae0db80a'::uuid,'80a2ae57-ac88-4493-b6c3-a103129c8ef6'::uuid,250.00::numeric,'BYN'),
    ('bc4a12cd-b983-4761-adcd-34c590eb02d3'::uuid,'9fefd5e4-053b-4563-8db8-9503e16ccf72'::uuid,'3acc35a0-46cb-41b3-ab8e-9f662a80274d'::uuid,100.00::numeric,'BYN'),
    ('bc89dcc9-cc4b-4adf-99df-d72cc05e5b97'::uuid,'d5bfe21b-9001-4823-b6b0-242634ef2bac'::uuid,'f42b124d-b2d9-40eb-a8b0-a723c5510853'::uuid,150.00::numeric,'BYN'),
    ('c0f28878-24c8-4af8-979c-077a7fdceb5c'::uuid,'5a3c202f-6d58-4bf8-8742-7113d8e8ebc8'::uuid,'f830da27-c73f-4bd5-a28b-168b186e2c9c'::uuid,250.00::numeric,'BYN'),
    ('ca7cde79-9b1d-4d54-8942-64b24139014c'::uuid,'9b412ac6-690c-430b-8ce8-71afa057ac78'::uuid,'b162cf7a-c076-4791-b333-55ac9ff94c1a'::uuid,350.00::numeric,'BYN'),
    ('cd60358c-7efb-4b71-b62f-1e4692e36f26'::uuid,'a0088d04-6035-4124-9846-11492ffd062c'::uuid,'ee951e4b-c227-4378-9c6e-dbb2d82b8c68'::uuid,55.00::numeric,'BYN'),
    ('ce737f06-7bc9-4a29-8c19-0c109a979069'::uuid,'4bd4427b-3829-46c8-be24-5f501fa626dc'::uuid,'a2347ee5-d440-4564-86c3-0de193203fd8'::uuid,250.00::numeric,'BYN'),
    ('d1575dfa-6a05-42c4-937a-8fca8da28725'::uuid,'02796a1c-00b7-4f20-ba4f-41b8e423effd'::uuid,'23eeb258-cf88-4f3e-a8a9-5eb63fbeeaea'::uuid,250.00::numeric,'BYN'),
    ('d313bcb9-02cf-470a-9db5-06cb6c5d5a59'::uuid,'91372acb-abb7-4dd8-80f1-f4a9ac0ff6a6'::uuid,'cc866235-17ec-4e61-8f86-805a309130da'::uuid,250.00::numeric,'BYN'),
    ('d37310a4-1a9b-42c3-83fc-9de2d2fb6acc'::uuid,'9a19648b-755e-416d-8770-b012181e1d54'::uuid,'cdb2d707-431d-4ded-aca8-cccd0d249ff7'::uuid,250.00::numeric,'BYN'),
    ('d5c21bb7-af98-453e-a332-59d80d60d1aa'::uuid,'76cca17f-4c5d-4487-8785-1c3539df875e'::uuid,'7efc3ff3-b0ce-4e83-9dd9-82eb15d2f8cd'::uuid,150.00::numeric,'BYN'),
    ('d9238ee3-9909-4fd8-88a2-9df8dc6a83dd'::uuid,'b03d6521-389c-40ab-85b9-502c6c034ae5'::uuid,'44b6e4a7-1f03-4cc4-b989-8eac916eedbf'::uuid,250.00::numeric,'BYN'),
    ('d9491361-20b2-4af3-8059-0e38e45458d6'::uuid,'d4a881eb-dbe2-4563-b39d-915d8c07293f'::uuid,'e73f2f82-a6f5-489a-a8e9-251e8b935315'::uuid,70.00::numeric,'BYN'),
    ('dc144342-6461-4999-bdd7-17c2a5ccb592'::uuid,'b6ddcb93-4512-4f08-a2e9-a2fe1565ed4f'::uuid,'0774f59f-cd12-4420-9dcc-77ed20016c0a'::uuid,250.00::numeric,'BYN'),
    ('dcd47045-7963-4556-ae57-e2d0b0c2476e'::uuid,'e305980d-72fe-4133-befb-f1b2731ec457'::uuid,'d4868588-7ad4-4cf9-b905-b9ac6f2c4b26'::uuid,250.00::numeric,'BYN'),
    ('ddefcdc9-3711-4998-a726-4ab1f8899983'::uuid,'01414049-c794-4725-a325-bf8d2866b2e9'::uuid,'34b0fb76-992e-4af8-97b4-d12ca06a5fbc'::uuid,80.00::numeric,'BYN'),
    ('e254b80d-38c5-4b75-9a22-5b5c709994b3'::uuid,'12df52f0-933f-4225-a871-6843443a139b'::uuid,'efd96b27-758a-45a0-9f36-e8bcb97c1e5b'::uuid,55.00::numeric,'BYN'),
    ('e301fabb-7aff-416a-b339-518205861114'::uuid,'d2e260e0-4895-4fc3-a4de-03ffe60dfe54'::uuid,'6973e272-b69e-4913-9019-f673f0d72266'::uuid,250.00::numeric,'BYN'),
    ('e3412120-7843-4ce9-9033-5052bc26759a'::uuid,'4ce40751-b67c-4d59-8848-a32756162116'::uuid,'b8ba8425-a2c8-4537-8e55-6220b6c41f11'::uuid,150.00::numeric,'BYN'),
    ('e452e784-65dc-48c4-9456-da0bc15032a5'::uuid,'e52a971b-d117-4f79-a3ef-a8931c06fc44'::uuid,'5906183c-42b8-48b9-b57b-e948a8217c64'::uuid,250.00::numeric,'BYN'),
    ('e7a320bc-ce96-4b70-ba57-158ae7c06cd7'::uuid,'6f8536f1-012b-4f1e-bece-acc30cdfdc5a'::uuid,'850e930b-ffb5-46f4-b587-7103ffc1f069'::uuid,250.00::numeric,'BYN'),
    ('e7e8aad4-c59c-4d66-8882-052f7545a885'::uuid,'09eb678b-f55d-4f74-89b9-47ab91e446c0'::uuid,'201ecc3b-1247-4f80-a0bb-6b9f1ba58829'::uuid,250.00::numeric,'BYN'),
    ('e93ff9fe-97f4-4a27-8770-d55fef78e5da'::uuid,'d7fbaca6-4a2c-4947-aaf5-d92a24465816'::uuid,'b39b5fb9-10f8-468d-a7e7-69f4e5ef742f'::uuid,250.00::numeric,'BYN'),
    ('ec774ffb-a257-47b5-95c2-1e4ee4bb719a'::uuid,'179e675c-70c4-417e-8dd8-7f2ca001f518'::uuid,'3d7293f5-9270-4088-a483-18f929843b2e'::uuid,250.00::numeric,'BYN'),
    ('eda63b40-b5ab-4a44-860c-218af7ac927a'::uuid,'7d9d9178-2d2d-402a-9cf0-cf02f2f70315'::uuid,'a6b6fcd5-16e6-4b57-ae2c-669de9046d88'::uuid,250.00::numeric,'BYN'),
    ('f60ed2f0-277c-4f28-ae26-b7f05c2c05a7'::uuid,'ad32d764-13bd-434f-9f74-b9b13997daf0'::uuid,'5e0a74b8-ed15-492a-9c2f-eb6897c38fef'::uuid,100.00::numeric,'BYN'),
    ('f68582b0-516d-42e8-9045-b89f8d96f367'::uuid,'ed944f9c-3ce0-4c03-836c-3d432f3db661'::uuid,'da087c2c-3632-41bd-9fd3-99b3b36f4f5d'::uuid,250.00::numeric,'BYN');

  CREATE TEMP TABLE m_e_payments (id uuid PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO m_e_payments VALUES
    ('014139a1-9b2a-41d3-92d9-534db7e326c6'::uuid),
    ('02c37c7e-c40e-4785-b116-e582b18254da'::uuid),
    ('031382a5-f609-43ac-8ffb-f942b9e4bc10'::uuid),
    ('04070cee-f1c7-4cc5-8ae1-542cfbfd161c'::uuid),
    ('04b7caf3-c5be-42b3-9f83-ab01b667eeec'::uuid),
    ('05260895-8da8-4717-b84a-4c0a148754c2'::uuid),
    ('053a770b-86fd-42c6-bc68-b28478178da1'::uuid),
    ('08545286-cf9d-48df-98bb-8d755c06a596'::uuid),
    ('08f02c62-7423-4ea0-8d2a-a8db80236bf5'::uuid),
    ('08f14f90-52e1-4300-a526-02402a8efacf'::uuid),
    ('0a0b9d18-ec9f-45cd-8ba0-06ad6ebe1195'::uuid),
    ('0a44c026-5173-4de3-9f6c-5495e6c4da3f'::uuid),
    ('0b164ba5-992b-42c6-9952-68f2ca2b2dce'::uuid),
    ('0b8e2718-e421-4611-9888-8f58b8cef1c4'::uuid),
    ('0d395cb0-8a61-40c4-955b-304aa4cb19ec'::uuid),
    ('0e6e1eb0-38a1-4e4f-9d3c-8224a15bc229'::uuid),
    ('0f246f54-f806-44fe-ab27-53b3f34ab6ac'::uuid),
    ('11b16526-93b9-411a-98da-66f8bb16b2fa'::uuid),
    ('1518caaf-ded6-4cdf-a68a-754dc756f80a'::uuid),
    ('19bda60e-e032-4a22-8d83-07bef9dd9298'::uuid),
    ('1a6a244b-7599-4904-b0b6-683be604c80a'::uuid),
    ('1cf9a73f-1261-4116-9820-43e247806255'::uuid),
    ('1dc9748e-b4cc-456b-b27f-06e700bbc49c'::uuid),
    ('20250786-90f8-4b21-b4dc-411120018da2'::uuid),
    ('206e6fc8-5ed2-4c72-86d1-00bba1769962'::uuid),
    ('20e96188-d44f-4f9c-bc90-1e5c96296a40'::uuid),
    ('20edba33-0d96-4c5d-8fe1-e7862c112a0d'::uuid),
    ('214f5b7c-1d94-4e65-9b82-3120c8f5b6b2'::uuid),
    ('23c5c7ae-795f-4f1c-9ae7-059625889357'::uuid),
    ('245fdbea-5710-4102-9391-ae53f01d79d7'::uuid),
    ('24b96c8b-dced-4611-b2f7-d1146c9ef7ac'::uuid),
    ('24c760d2-dd62-411d-a4f7-485d7ffd7abe'::uuid),
    ('2514b9a9-a806-4441-aaf5-6d5f37953413'::uuid),
    ('254f445b-7860-4ff0-b257-fded8994d3e2'::uuid),
    ('2b8a2a30-2e4d-49ef-ade3-40cfdd4d592e'::uuid),
    ('2f9b7f8d-ea27-469e-8a57-aa9f5e7242a9'::uuid),
    ('2fedd8ba-d7eb-4b40-9b8d-1501c1040151'::uuid),
    ('31e39a25-01b3-49ed-962b-64f652424b0e'::uuid),
    ('33f02dc7-6967-407f-bdba-42f2ce3c4f20'::uuid),
    ('34c2d02a-6e48-438c-95c4-830a65cace32'::uuid),
    ('37ba7055-9d45-4066-b01d-13fae2258591'::uuid),
    ('380c2d70-6b57-47a9-b92f-362933e48cb3'::uuid),
    ('39c32ddd-6d29-4c51-b343-6caee2adc846'::uuid),
    ('3c3ade9b-75f4-4ced-a162-542be4c0c19e'::uuid),
    ('3ee73ab7-351b-4748-8133-b4d77ba9d380'::uuid),
    ('43768752-c523-4207-9584-90819d277d23'::uuid),
    ('463b13e8-407a-4167-9e5c-8764c8cb8ecd'::uuid),
    ('4800fd0f-2e1f-45db-ab92-cdd19edfc472'::uuid),
    ('489a8408-b65e-42c3-bd41-3262ba3f93a8'::uuid),
    ('4b6df8c5-78b0-4bfc-8c2a-6a00d50ff019'::uuid),
    ('4d784297-afa5-4255-ae82-5df13eff7ad2'::uuid),
    ('4d9854f5-80e0-4fe0-90f2-2936b63faf64'::uuid),
    ('4f67a6f4-2521-4284-a31a-992b2e2fa6cd'::uuid),
    ('4fb01adc-9cb3-4512-8d34-589a1f59e8db'::uuid),
    ('4fc5c749-2601-4f66-ad3c-6b0afebc3649'::uuid),
    ('4fdecbb6-5490-43c3-9ba3-bba6c3345239'::uuid),
    ('506667ed-f643-46e8-812e-58aaa0bc6de2'::uuid),
    ('52af8964-d9b5-4078-815e-26a22b3f5426'::uuid),
    ('5341aa54-0ba1-4478-9acf-7090a640cd84'::uuid),
    ('558b9c9d-a4c3-4e10-b86a-20e61c58e031'::uuid),
    ('559212f9-69eb-4285-87c1-c345df7e8d90'::uuid),
    ('55b12d8e-557c-4c67-8a9b-e7a35e6e4e74'::uuid),
    ('59a31dc1-2849-4d3f-a92b-b72c863e1888'::uuid),
    ('5a12ec7e-268b-411f-a41c-45d1b6e22517'::uuid),
    ('5a28271c-9f6d-468d-bf63-5e178be646ff'::uuid),
    ('5bca9c43-1b72-4809-a9c3-f44b8e52bb8e'::uuid),
    ('5c026b5c-8abd-4a60-a420-b91efffc2466'::uuid),
    ('5fb89b65-1b3a-416f-a480-f465bb4f3946'::uuid),
    ('614e4a9a-a1d2-4519-89b3-359eb648b9f5'::uuid),
    ('66c1a657-d0cf-4a71-8538-2c349cf6a5f5'::uuid),
    ('69088617-3ff9-4f95-9e7f-8186ba926297'::uuid),
    ('69139432-192f-44ae-8cef-209bacfd9a33'::uuid),
    ('6a9c370b-4725-4a1e-bcda-2c59f9a498ed'::uuid),
    ('6c4c4352-0b48-4bad-9168-b6e525f7d900'::uuid),
    ('6cb80bdf-25e4-4757-a4d4-1263074b420d'::uuid),
    ('6d98aa82-d364-46a1-bccc-38dedd7480ed'::uuid),
    ('6ef3805d-6fb1-4739-a3aa-ff09f99799aa'::uuid),
    ('6f947587-5059-4d93-909e-0538c81775e5'::uuid),
    ('710c2966-35e1-4e63-b540-be75f40555a6'::uuid),
    ('717c0d0f-5d5a-40cc-9e00-b5b502be62f6'::uuid),
    ('736569f8-5a03-4c43-a041-1b79e816c01f'::uuid),
    ('74c3b8bd-f5aa-4010-9cab-0a20ce249f24'::uuid),
    ('755aa4ea-2333-428c-950f-d714ae6cc1d7'::uuid),
    ('7587e325-e9f6-4b32-b59e-3586877b07fe'::uuid),
    ('761bfc4b-c870-4737-be40-58ccc7fc6996'::uuid),
    ('772435a8-46b6-48bd-9a3d-d350a4becd9e'::uuid),
    ('776a3c0b-918f-4d22-a5d2-472cb0f80203'::uuid),
    ('7ad04e44-6f97-40f8-aee0-cff8d894107a'::uuid),
    ('7c5a3888-1424-45aa-96fe-5f261b943cdf'::uuid),
    ('7ccff7ad-e353-4d38-9b46-4238a32a6695'::uuid),
    ('7ef03b9f-b291-4307-a217-9112c7f7b3f5'::uuid),
    ('7f3f6e66-1f48-4c97-bd50-9b6601c9e3fb'::uuid),
    ('7f623a4f-8d97-4573-863f-f7228bdf5c73'::uuid),
    ('806d7482-db46-4be7-88c8-b85089b84fd3'::uuid),
    ('80c7436e-c687-46d0-bbc4-d39ca865f52b'::uuid),
    ('824f89a5-3188-45b9-8d85-10e405ee10f1'::uuid),
    ('82d6b049-5d3c-43ab-8ff6-77f9b82b2668'::uuid),
    ('8576d682-8593-400c-a446-e4e3fc097815'::uuid),
    ('86c51d29-9fe6-495b-b79f-cb26e5d688e7'::uuid),
    ('86ea831c-d04e-4e8c-b893-a7427a540891'::uuid),
    ('893201fa-1906-482b-9951-29d5ebceab31'::uuid),
    ('8af950aa-042e-4702-8806-8b0cb7330e2d'::uuid),
    ('8d3d4431-442e-4f4f-bd96-ef1d062a1b5e'::uuid),
    ('8df4137b-0518-44f9-a2fc-8b360896765c'::uuid),
    ('8e3fa7ef-a79b-491e-b000-47d2d1a15a9e'::uuid),
    ('9165b6dd-7489-454e-a3c9-f40579e58b85'::uuid),
    ('925b01ce-ad15-4d74-8d50-d5ec65956d1a'::uuid),
    ('929beec4-6923-415a-a5ff-2c872c956e53'::uuid),
    ('9385e0cc-046a-4ecd-b245-e4a1d9fadc0e'::uuid),
    ('9452649b-3aa1-4d7f-af45-c0a48ae21297'::uuid),
    ('94bf5ff3-f485-47b5-886a-733d43c61dad'::uuid),
    ('973b11c4-210c-419e-b50e-eb41f268c304'::uuid),
    ('989c383f-8456-42f0-b5d0-c0ae133b98d9'::uuid),
    ('9918dc5a-281d-4c8e-96cf-6b997d13fc57'::uuid),
    ('995a9e8b-c6eb-4d02-91b3-296e087a10e5'::uuid),
    ('9a766c54-1f1a-4dca-83e1-8b8cc7e5b819'::uuid),
    ('9aab3816-0b2c-4e15-a3e0-aaff122d0eee'::uuid),
    ('9ad36740-25b7-4ab4-a37e-03ab56fdbea6'::uuid),
    ('9b3133f0-48ac-4bf6-81ef-d33f39369eb6'::uuid),
    ('9c74db3d-4a2f-4229-9e38-6a8876680fc4'::uuid),
    ('9c755705-b32b-46e1-9e80-daba288f9aa5'::uuid),
    ('9da44d07-ffff-411c-9a82-9330b454c8e2'::uuid),
    ('9e90176e-3452-461c-b62e-67e486994a83'::uuid),
    ('9f2ba51b-1f01-4896-a46c-0c4112e47ea3'::uuid),
    ('a1054c4f-07fc-4470-b88d-e9856a77b634'::uuid),
    ('a2058109-d23a-40ce-b01a-b06b91aa1bfc'::uuid),
    ('a3329cfc-45aa-4e43-ae43-58cdba031ec0'::uuid),
    ('a6ef0492-808b-4472-9fca-e6657d0dd3f5'::uuid),
    ('a74ebb91-fb35-425b-b662-8b082dbca3dc'::uuid),
    ('a9465484-a922-4c06-94af-1c8d5a6d5fb0'::uuid),
    ('a95fcffa-eb7f-421e-989c-bb505c4b9428'::uuid),
    ('aa91cba4-12be-47c5-9c93-8cb58dde16e8'::uuid),
    ('ab6e18a8-1cc3-4e13-8162-f766fff0650c'::uuid),
    ('ab75fc6d-f84f-4e2b-b49c-1aa71ab223a1'::uuid),
    ('ad6a416a-0bb3-497d-83e6-0ef35a2bf37d'::uuid),
    ('ae4d37d9-d2f4-4b75-94ba-169d62d3c3df'::uuid),
    ('b09993d0-2804-420b-9f2c-ec95632a9b32'::uuid),
    ('b3af23cf-a91c-448e-aefc-608f9cc49e2a'::uuid),
    ('b53f92eb-76bd-4252-947d-45c3427ed356'::uuid),
    ('b56c6cd6-4eef-47c1-a0d0-717da8c53960'::uuid),
    ('b59c06ec-258a-43d3-a86c-07be3ad034fd'::uuid),
    ('b6625670-1715-4675-972d-ddc7d5e00587'::uuid),
    ('b71c4419-35e7-4df8-8b92-b923f3efd26a'::uuid),
    ('b86247b4-7fce-4e8d-a8ec-c2472c0bddff'::uuid),
    ('b8b9c828-62e3-4e36-837c-7b0beb8af870'::uuid),
    ('b8ecf3fe-5ca4-425c-aac5-fc769b3923e7'::uuid),
    ('bd60258e-baf6-41cb-9452-c9daa6759328'::uuid),
    ('bd7c9770-5695-4817-8245-caac1ed505e8'::uuid),
    ('bd7ce944-35f8-4386-bac8-80c99b121aa8'::uuid),
    ('bfc047bb-0113-4dc8-a63a-cc27ad25c64f'::uuid),
    ('c37ee249-5907-494e-84d0-fc223d0f5f80'::uuid),
    ('c4e9a382-8936-4a70-a5f1-42aece609625'::uuid),
    ('c55aff5f-4ce8-4b3c-aa6f-008208c66a08'::uuid),
    ('c89bd314-f337-47c2-b930-f1f9f2406c3e'::uuid),
    ('c9ce9af2-cabd-435f-8ac4-cb0c8b9d6aa6'::uuid),
    ('ca655d35-3d79-4a09-bcd2-272628e5e962'::uuid),
    ('cd7c7029-4859-4abb-bd89-5139b4b3c955'::uuid),
    ('cec31c44-3588-4a97-9ae7-81c7ecd1919c'::uuid),
    ('d00667eb-53d8-4507-a57d-9a2398f8ad7a'::uuid),
    ('d03fbc99-133c-4ff9-ad0a-053ef4131a72'::uuid),
    ('d1ebc584-b77e-45bb-aadc-66cb144f3ab8'::uuid),
    ('d2eabdb1-cf1d-4ae0-bd63-aa92bf0d7cb3'::uuid),
    ('d331cc53-e2c4-4768-9bc9-f53a24de78c7'::uuid),
    ('d3739ee3-c1fd-4cf5-aa8b-9a3bd3503026'::uuid),
    ('d5c1206d-e54a-479e-b5bc-929f198a5818'::uuid),
    ('d6a0b15d-757d-4b58-9d6a-adeb4936b81e'::uuid),
    ('d6f568bb-7633-4ae0-a484-f8c2dca991dd'::uuid),
    ('d986cf0c-685c-4a34-8711-77e554f3c85e'::uuid),
    ('dcac61ae-e905-4b94-b0d5-67219117e429'::uuid),
    ('de87612e-a2b7-4438-9cb1-9d448b3d298e'::uuid),
    ('df205427-e435-440b-9e5a-d55f0887e3e7'::uuid),
    ('df678c9a-91f3-4bd8-a136-76b0c0ca93b3'::uuid),
    ('dfc92705-68aa-41e2-96c9-e28ee14fed18'::uuid),
    ('e1f64a52-3f8c-447e-9554-8d43e4e62260'::uuid),
    ('e251d28a-6e6b-4f9c-b9ec-401bc6b2ce7d'::uuid),
    ('e2f4c0ba-4896-4b4e-b5bc-456b204790bb'::uuid),
    ('e33d2e0c-7963-4dc0-aca4-69c5844776e9'::uuid),
    ('e3dc1360-fd56-4344-b06e-139e233fcdc7'::uuid),
    ('e49e82a9-c861-47f4-8c32-bb14b45f374b'::uuid),
    ('e52f6cde-0af3-400c-9296-f883876fad6d'::uuid),
    ('e566b8fb-b59a-4deb-a979-31f21b742ca1'::uuid),
    ('e618d50f-5e33-497d-a172-7032e596534c'::uuid),
    ('e86f2f93-aece-46b3-a370-ea5d7444487e'::uuid),
    ('e9dd42a0-d7d5-42de-8bf0-eb02c35267d7'::uuid),
    ('ea62290d-96e8-41cd-9d1c-9f01c173a990'::uuid),
    ('ed86ce59-2bf1-480e-a886-1a394a5f9058'::uuid),
    ('ed9141d8-0580-4f02-8a40-9a0e6d256ed2'::uuid),
    ('edb26a84-048d-4149-9eff-06b366921012'::uuid),
    ('ee7da1c1-5014-4457-b722-75a7dfe553b8'::uuid),
    ('eed27579-fd31-44a6-a147-03b7e9384cd4'::uuid),
    ('efca5528-c199-400c-830c-9bddf6afe615'::uuid),
    ('f0438616-2989-4e3a-b48d-4a4aa8c54d20'::uuid),
    ('f15cfd61-04a8-4a71-ad92-9090d03bfb1e'::uuid),
    ('f174e6c8-d352-40a4-893f-eaf2f4b45296'::uuid),
    ('f1c20872-c064-49dc-bcfc-004e7ae607e1'::uuid),
    ('f46e6c77-0d2a-4150-a19f-460217894b63'::uuid),
    ('f596f21c-680b-492f-83b1-d2186108b631'::uuid),
    ('fa51d0d3-15c3-4968-a861-c0f4819d2127'::uuid),
    ('fd0ba08e-c00e-4538-80d4-4e6cc57c2a55'::uuid),
    ('fe5ecc63-da98-400f-9620-3aa0e3705afe'::uuid),
    ('fe8a490d-49f5-43b4-a71c-7a94ed453bd5'::uuid);

  ------------------------------------------------------------------
  -- 1. Lock rows FOR UPDATE and re-verify semantics
  ------------------------------------------------------------------
  PERFORM 1 FROM public.payments_v2 p
    JOIN m_a_payments m ON m.id = p.id
    FOR UPDATE OF p;

  PERFORM 1 FROM public.payments_v2 p
    JOIN m_c_payments m ON m.legacy_id = p.id
    FOR UPDATE OF p;

  PERFORM 1 FROM public.payments_v2 p
    JOIN m_e_payments m ON m.id = p.id
    FOR UPDATE OF p;

  PERFORM 1 FROM public.orders_v2 o
    JOIN m_a_orders m ON m.id = o.id
    FOR UPDATE OF o;

  ------------------------------------------------------------------
  -- 2. Semantic drift checks (fail-closed)
  ------------------------------------------------------------------
  SELECT count(*) INTO v_actual FROM public.payments_v2 p
    JOIN m_a_payments m ON m.id=p.id
   WHERE p.provider='admin_test' AND coalesce(p.is_deleted,false)=false;
  IF v_actual <> v_a_pay_expected THEN
    RAISE EXCEPTION 'STAGE6_DRIFT: A payments expected % got %', v_a_pay_expected, v_actual;
  END IF;

  SELECT count(*) INTO v_actual FROM public.orders_v2 o
    JOIN m_a_orders m ON m.id=o.id
   WHERE o.order_number LIKE 'ORD-TEST-%' AND coalesce(o.is_deleted,false)=false;
  IF v_actual <> v_a_ord_expected THEN
    RAISE EXCEPTION 'STAGE6_DRIFT: A orders expected % got %', v_a_ord_expected, v_actual;
  END IF;

  SELECT count(*) INTO v_actual
    FROM m_c_payments m
    JOIN public.payments_v2 p ON p.id = m.legacy_id
    JOIN public.payments_v2 cb ON cb.id = m.canonical_id
   WHERE p.provider='admin'
     AND p.meta->>'source'='admin_from_payment'
     AND (p.meta->>'queue_payment_id')::uuid = m.queue_id
     AND p.amount = m.expected_amount
     AND p.currency = m.expected_currency
     AND coalesce(p.is_deleted,false)=false
     AND cb.provider='bepaid'
     AND cb.status='succeeded'
     AND cb.amount = m.expected_amount
     AND cb.currency = m.expected_currency
     AND coalesce(cb.is_deleted,false)=false;
  IF v_actual <> v_c_pay_expected THEN
    RAISE EXCEPTION 'STAGE6_DRIFT: C lineage expected % got %', v_c_pay_expected, v_actual;
  END IF;

  SELECT count(*) INTO v_actual FROM public.payments_v2 p
    JOIN m_e_payments m ON m.id=p.id
   WHERE p.provider='admin' AND p.meta->>'source'='admin_grant'
     AND p.amount=0 AND coalesce(p.is_deleted,false)=false;
  IF v_actual <> v_e_pay_expected THEN
    RAISE EXCEPTION 'STAGE6_DRIFT: E payments expected % got %', v_e_pay_expected, v_actual;
  END IF;

  ------------------------------------------------------------------
  -- 3. Snapshot untouched tables (checksum)
  ------------------------------------------------------------------
  SELECT md5(string_agg(id::text, ',' ORDER BY id))
    INTO v_queue_checksum_before FROM public.payment_reconcile_queue;
  SELECT md5(string_agg(id::text || ':' || amount::text, ',' ORDER BY id))
    INTO v_bepaid_checksum_before FROM public.payments_v2
   WHERE provider='bepaid' AND status='succeeded' AND coalesce(is_deleted,false)=false;

  ------------------------------------------------------------------
  -- 4. Execute soft-archive (guarded by manifest join)
  ------------------------------------------------------------------

  UPDATE public.payments_v2 p
     SET is_deleted = true,
         meta = coalesce(p.meta,'{}'::jsonb) || jsonb_build_object(
           'stage6_cleanup','admin_test_fixture',
           'stage6_cleanup_at', now()
         )
    FROM m_a_payments m
   WHERE p.id = m.id AND p.provider='admin_test'
     AND coalesce(p.is_deleted,false)=false;
  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_a_pay_expected THEN
    RAISE EXCEPTION 'STAGE6_UPDATE_A_PAY: expected % got %', v_a_pay_expected, v_actual;
  END IF;

  UPDATE public.orders_v2 o
     SET is_deleted = true,
         meta = coalesce(o.meta,'{}'::jsonb) || jsonb_build_object(
           'stage6_cleanup','admin_test_fixture',
           'stage6_cleanup_at', now()
         )
    FROM m_a_orders m
   WHERE o.id = m.id AND o.order_number LIKE 'ORD-TEST-%'
     AND coalesce(o.is_deleted,false)=false;
  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_a_ord_expected THEN
    RAISE EXCEPTION 'STAGE6_UPDATE_A_ORD: expected % got %', v_a_ord_expected, v_actual;
  END IF;

  UPDATE public.subscriptions_v2 s
     SET meta = coalesce(s.meta,'{}'::jsonb) || jsonb_build_object(
           'stage6_cleanup','admin_test_fixture',
           'stage6_cleanup_at', now()
         )
    FROM m_a_subs m
   WHERE s.id = m.id;
  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_a_sub_expected THEN
    RAISE EXCEPTION 'STAGE6_UPDATE_A_SUB: expected % got %', v_a_sub_expected, v_actual;
  END IF;

  UPDATE public.ai_generated_documents d
     SET meta = coalesce(d.meta,'{}'::jsonb) || jsonb_build_object(
           'stage6_cleanup','test_document_void',
           'void_reason','admin_test_fixture',
           'stage6_cleanup_at', now()
         )
    FROM m_a_docs m
   WHERE d.id = m.id;
  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_a_doc_expected THEN
    RAISE EXCEPTION 'STAGE6_UPDATE_A_DOC: expected % got %', v_a_doc_expected, v_actual;
  END IF;

  UPDATE public.payments_v2 p
     SET is_deleted = true,
         meta = coalesce(p.meta,'{}'::jsonb) || jsonb_build_object(
           'stage6_cleanup','admin_from_payment_duplicate',
           'stage6_cleanup_at', now(),
           'canonical_bepaid_payment_id', m.canonical_id::text,
           'queue_payment_id_verified', m.queue_id::text
         )
    FROM m_c_payments m
   WHERE p.id = m.legacy_id
     AND p.provider='admin'
     AND p.meta->>'source'='admin_from_payment'
     AND p.amount = m.expected_amount
     AND p.currency = m.expected_currency
     AND (p.meta->>'queue_payment_id')::uuid = m.queue_id
     AND coalesce(p.is_deleted,false)=false;
  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_c_pay_expected THEN
    RAISE EXCEPTION 'STAGE6_UPDATE_C_PAY: expected % got %', v_c_pay_expected, v_actual;
  END IF;

  UPDATE public.payments_v2 p
     SET is_deleted = true,
         meta = coalesce(p.meta,'{}'::jsonb) || jsonb_build_object(
           'stage6_cleanup','admin_grant_archive',
           'stage6_cleanup_at', now()
         )
    FROM m_e_payments m
   WHERE p.id = m.id
     AND p.provider='admin'
     AND p.meta->>'source'='admin_grant'
     AND p.amount = 0
     AND coalesce(p.is_deleted,false)=false;
  GET DIAGNOSTICS v_actual = ROW_COUNT;
  IF v_actual <> v_e_pay_expected THEN
    RAISE EXCEPTION 'STAGE6_UPDATE_E_PAY: expected % got %', v_e_pay_expected, v_actual;
  END IF;

  ------------------------------------------------------------------
  -- 5. Post-invariants (fail-closed)
  ------------------------------------------------------------------
  SELECT count(*) INTO v_actual FROM public.payments_v2
   WHERE provider='admin_test' AND coalesce(is_deleted,false)=false;
  IF v_actual <> 0 THEN RAISE EXCEPTION 'STAGE6_POST: active admin_test = %', v_actual; END IF;

  SELECT count(*) INTO v_actual FROM public.orders_v2
   WHERE order_number LIKE 'ORD-TEST-%' AND coalesce(is_deleted,false)=false;
  IF v_actual <> 0 THEN RAISE EXCEPTION 'STAGE6_POST: active ORD-TEST = %', v_actual; END IF;

  SELECT count(*) INTO v_actual FROM public.payments_v2
   WHERE provider='admin' AND meta->>'source'='admin_from_payment'
     AND coalesce(is_deleted,false)=false;
  IF v_actual <> 0 THEN RAISE EXCEPTION 'STAGE6_POST: active admin_from_payment = %', v_actual; END IF;

  SELECT count(*) INTO v_actual FROM public.payments_v2
   WHERE provider='admin' AND meta->>'source'='admin_grant'
     AND coalesce(is_deleted,false)=false;
  IF v_actual <> 0 THEN RAISE EXCEPTION 'STAGE6_POST: active admin_grant = %', v_actual; END IF;

  SELECT count(*) INTO v_actual FROM public.payments_v2
   WHERE provider='admin' AND meta->>'source'='admin_deal_only'
     AND coalesce(is_deleted,false)=false;
  IF v_actual <> 1 THEN RAISE EXCEPTION 'STAGE6_POST: admin_deal_only drift = %', v_actual; END IF;

  SELECT md5(string_agg(id::text, ',' ORDER BY id))
    INTO v_queue_checksum_after FROM public.payment_reconcile_queue;
  IF v_queue_checksum_before IS DISTINCT FROM v_queue_checksum_after THEN
    RAISE EXCEPTION 'STAGE6_POST: payment_reconcile_queue drift';
  END IF;

  SELECT md5(string_agg(id::text || ':' || amount::text, ',' ORDER BY id))
    INTO v_bepaid_checksum_after FROM public.payments_v2
   WHERE provider='bepaid' AND status='succeeded' AND coalesce(is_deleted,false)=false;
  IF v_bepaid_checksum_before IS DISTINCT FROM v_bepaid_checksum_after THEN
    RAISE EXCEPTION 'STAGE6_POST: canonical bepaid drift';
  END IF;

  RAISE NOTICE 'STAGE6_CLEANUP: soft-archived % A payments, % A orders, % A subs meta, % A docs meta, % C payments, % E payments',
    v_a_pay_expected, v_a_ord_expected, v_a_sub_expected, v_a_doc_expected, v_c_pay_expected, v_e_pay_expected;
END
$stage6$;