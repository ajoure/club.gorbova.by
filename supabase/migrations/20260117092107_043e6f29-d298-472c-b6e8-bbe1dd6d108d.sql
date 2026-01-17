-- Create trigger for sync_payment_method_revocation
DROP TRIGGER IF EXISTS trigger_payment_method_revocation ON payment_methods;

CREATE TRIGGER trigger_payment_method_revocation
AFTER UPDATE ON payment_methods
FOR EACH ROW
EXECUTE FUNCTION sync_payment_method_revocation();