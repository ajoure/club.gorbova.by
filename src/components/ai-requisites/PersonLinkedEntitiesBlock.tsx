/**
 * PersonLinkedEntitiesBlock — read-only list of entities linked to a person.
 * Strictly tolerant: shows empty state if no links, gracefully handles missing joins.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Loader2, Link2 } from 'lucide-react';

interface PersonLinkedEntitiesBlockProps {
  personId: string;
}

interface LinkedEntity {
  id: string;
  entityName: string;
  entityType: 'legal_entity' | 'entrepreneur' | string;
  roleName: string | null;
}

export function PersonLinkedEntitiesBlock({ personId }: PersonLinkedEntitiesBlockProps) {
  const { data: linkedEntities = [], isLoading } = useQuery({
    queryKey: ['person-linked-entities', personId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('legal_details_entity_person_links')
        .select(`
          id,
          role_type,
          custom_role_text,
          legal_details_id,
          role_catalog_id,
          client_legal_details!legal_details_entity_person_links_legal_details_id_fkey (
            id, client_type, leg_name, ent_name, leg_org_form
          ),
          legal_details_roles_catalog!legal_details_entity_person_links_role_catalog_id_fkey (
            label
          )
        `)
        .eq('person_id', personId);

      if (error) {
        console.error('Failed to load linked entities:', error);
        return [];
      }

      return (data || []).map((link: any): LinkedEntity => {
        const entity = link.client_legal_details;
        const roleCatalog = link.legal_details_roles_catalog;
        const entityName = entity
          ? (entity.client_type === 'entrepreneur' ? entity.ent_name : entity.leg_name) || 'Без названия'
          : 'Без названия';
        const entityType = entity?.client_type || 'legal_entity';
        const roleName = roleCatalog?.label || link.custom_role_text || null;

        return { id: link.id, entityName, entityType, roleName };
      });
    },
    enabled: !!personId,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          Связанные компании
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : linkedEntities.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Нет связанных компаний</p>
        ) : (
          <div className="space-y-2">
            {linkedEntities.map((link) => (
              <div key={link.id} className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{link.entityName}</span>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {link.entityType === 'entrepreneur' ? 'ИП' : 'ЮЛ'}
                  </Badge>
                </div>
                {link.roleName && (
                  <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                    {link.roleName}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
