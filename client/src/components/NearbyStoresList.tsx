import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Gift } from "lucide-react";
import { formatDistance } from "../../../shared/geoUtils";

interface Store {
  id: number;
  name: string;
  category: string;
  address: string;
  distance?: number;
  coupons: Array<{
    id: number;
    title: string;
    discountType: string;
    discountValue: number;
  }>;
}

interface NearbyStoresListProps {
  stores: Store[];
  onStoreClick: (storeId: number) => void;
}

export function NearbyStoresList({ stores, onStoreClick }: NearbyStoresListProps) {
  return (
    <div className="space-y-4">
      {stores.map((store) => (
        <Card 
          key={store.id} 
          className="hover:shadow-lg transition-shadow cursor-pointer"
          onClick={() => onStoreClick(store.id)}
        >
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg">{store.name}</CardTitle>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="secondary">{store.category}</Badge>
                  {store.distance !== undefined && (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {formatDistance(store.distance)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {store.address}
              </p>
              {store.coupons.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-primary font-medium">
                  <Gift className="h-4 w-4" />
                  <span>{store.coupons[0].title}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
