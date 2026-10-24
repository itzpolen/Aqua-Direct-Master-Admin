import 'package:flutter_test/flutter_test.dart';
import 'package:test4/models/customer_cart.dart';

void main() {
  test('labels out-for-delivery orders for the customer order badge', () {
    final order = CustomerOrder(
      id: 'order-id',
      orderNumber: 1,
      stationName: 'Water station',
      status: 'out_for_delivery',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      total: 100,
      deliveryFee: 0,
      createdAt: DateTime(2026),
      addressSnapshot: const {},
      items: const [],
    );

    expect(order.statusLabel, 'Out for delivery');
    expect(order.isInProgress, isTrue);
  });
}
